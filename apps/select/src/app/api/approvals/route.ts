import { and, desc, eq, ne } from "drizzle-orm";

import { error, json } from "@/lib/api";
import {
  APPROVAL_STEP_LABELS,
  DEFAULT_APPROVAL_STATUS,
  SENT_APPROVAL_STATUS,
  type ApprovalInbox,
  type ApprovalInboxItem,
  type ApprovalInboxView,
  type ApprovalStatus,
} from "@/lib/approval";
import { AuthError, requireApprover } from "@/lib/auth";
import { db } from "@/lib/db";
import { enquiryTags, generalInfoInput, projects, stepApproval, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// The selection head's inbox: one entry per tag that has steps sent for
// approval, newest first.
//
//   GET ?view=awaiting (default) - tags with at least one step still to decide
//       ?view=decided            - tags whose sent steps are all decided
//       ?view=all
//
// Selection heads and system admins only.

type View = ApprovalInboxView;
const VIEWS: readonly View[] = ["awaiting", "decided", "all"];

export async function GET(req: Request) {
  try {
    requireApprover(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const raw = new URL(req.url).searchParams.get("view") ?? "awaiting";
  const view: View = (VIEWS as readonly string[]).includes(raw) ? (raw as View) : "awaiting";

  // Every sent-or-decided step. Pending ones haven't been sent, so they are
  // the engineer's business, not the selection head's.
  const rows = await db
    .select({
      tagId: stepApproval.tagId,
      step: stepApproval.step,
      status: stepApproval.status,
      sentAt: stepApproval.sentAt,
      tagName: enquiryTags.name,
      enquiryCode: projects.projectCode,
      projectName: projects.name,
      customerName: projects.customerName,
      pumpModel: generalInfoInput.selectedModel,
      sentByName: users.name,
      sentByEmail: users.email,
    })
    .from(stepApproval)
    .innerJoin(enquiryTags, eq(enquiryTags.id, stepApproval.tagId))
    .innerJoin(projects, eq(projects.id, enquiryTags.projectId))
    .leftJoin(generalInfoInput, eq(generalInfoInput.tagId, stepApproval.tagId))
    .leftJoin(users, eq(users.id, stepApproval.sentBy))
    .where(and(eq(stepApproval.selected, true), ne(stepApproval.status, DEFAULT_APPROVAL_STATUS)))
    .orderBy(desc(stepApproval.sentAt));

  const byTag = new Map<string, ApprovalInboxItem>();
  for (const r of rows) {
    let item = byTag.get(r.tagId);
    if (!item) {
      item = {
        tagId: r.tagId,
        tagName: r.tagName,
        enquiryCode: r.enquiryCode,
        projectName: r.projectName,
        customerName: r.customerName,
        pumpModel: r.pumpModel || null,
        // Rows are newest-first, so the first row seen is the latest send.
        sentByName: r.sentByName || r.sentByEmail || null,
        sentAt: r.sentAt ? r.sentAt.toISOString() : null,
        awaiting: 0,
        steps: [],
      };
      byTag.set(r.tagId, item);
    }
    item.steps.push({
      step: r.step,
      label: APPROVAL_STEP_LABELS[r.step] ?? `Step ${r.step}`,
      status: r.status as ApprovalStatus,
    });
    if (r.status === SENT_APPROVAL_STATUS) item.awaiting += 1;
  }

  const all = [...byTag.values()].map((item) => ({
    ...item,
    steps: item.steps.sort((a, b) => a.step - b.step),
  }));
  const items =
    view === "awaiting"
      ? all.filter((i) => i.awaiting > 0)
      : view === "decided"
        ? all.filter((i) => i.awaiting === 0)
        : all;

  const inbox: ApprovalInbox = {
    items,
    counts: {
      awaiting: all.filter((i) => i.awaiting > 0).length,
      decided: all.filter((i) => i.awaiting === 0).length,
      all: all.length,
    },
  };
  return json(inbox);
}
