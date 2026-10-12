import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { error, json } from "@/lib/api";
import {
  APPROVAL_STEP_LABELS,
  DEFAULT_APPROVAL_STATUS,
  SENT_APPROVAL_STATUS,
  isApprovableStep,
  isDecisionStatus,
  type ApprovalStatus,
  type DecisionStatus,
} from "@/lib/approval";
import { approvalStepGroups, type ApprovalReview } from "@/lib/approval-details";
import {
  appBaseUrl,
  dutyText,
  loadTagForm,
  loadTagInfo,
  userById,
} from "@/lib/approval-server";
import { AuthError, requireApprover } from "@/lib/auth";
import { describeTag, logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { stepApproval, users } from "@/lib/db/schema";
import { decisionEmail } from "@/lib/email/approval-emails";
import { describeEmailResult, sendEmail } from "@/lib/email/resend";

export const dynamic = "force-dynamic";

// One tag's approval request, for the selection head's review popup.
//
//   GET                 the tag's details + every sent step, with its data
//   POST {decisions}    decide steps still Awaiting Approval:
//                       [{ step, status: "Approved" | "Rejected", remarks }]
//                       A rejection needs a remark. Emails the engineer.
//
// Selection heads and system admins only.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REMARKS = 1000;

async function loadReview(tagId: string): Promise<ApprovalReview | null> {
  const info = await loadTagInfo(tagId);
  if (!info) return null;

  const [form, rows] = await Promise.all([
    loadTagForm(tagId),
    db
      .select({ row: stepApproval })
      .from(stepApproval)
      .where(
        and(
          eq(stepApproval.tagId, tagId),
          eq(stepApproval.selected, true),
          ne(stepApproval.status, DEFAULT_APPROVAL_STATUS),
        ),
      )
      .orderBy(asc(stepApproval.step)),
  ]);

  // Names for everyone who sent or decided, in one lookup.
  const ids = [
    ...new Set(rows.flatMap((r) => [r.row.sentBy, r.row.decidedBy]).filter(Boolean) as string[]),
  ];
  const people = ids.length
    ? await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const nameOf = (id: string | null) => {
    const p = people.find((u) => u.id === id);
    return p ? p.name || p.email : null;
  };

  return {
    tagId,
    tagName: info.tagName,
    enquiryCode: info.enquiryCode,
    projectName: info.projectName,
    customerName: info.customerName,
    pumpModel: form.selectedModel ?? "",
    duty: dutyText(form),
    media: form.media ?? "",
    steps: rows.map(({ row }) => ({
      step: row.step,
      label: APPROVAL_STEP_LABELS[row.step] ?? `Step ${row.step}`,
      status: row.status as ApprovalStatus,
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      sentByName: nameOf(row.sentBy),
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      decidedByName: nameOf(row.decidedBy),
      remarks: row.remarks,
      groups: approvalStepGroups(row.step, form),
    })),
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ tagId: string }> }) {
  try {
    requireApprover(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  const { tagId } = await params;
  if (!UUID_RE.test(tagId)) return error("Invalid tag id", 400);

  const review = await loadReview(tagId);
  if (!review) return error("Tag not found", 404);
  return json(review);
}

export async function POST(req: Request, { params }: { params: Promise<{ tagId: string }> }) {
  let claims;
  try {
    claims = requireApprover(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  const { tagId } = await params;
  if (!UUID_RE.test(tagId)) return error("Invalid tag id", 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  // Validate every decision before writing any, so a bad one can't leave the
  // request half-decided.
  const raw = Array.isArray(body.decisions) ? body.decisions : [];
  const decisions: { step: number; status: DecisionStatus; remarks: string | null }[] = [];
  for (const d of raw as Record<string, unknown>[]) {
    const step = Number(d?.step);
    const status = String(d?.status ?? "");
    const remarks = String(d?.remarks ?? "").trim().slice(0, MAX_REMARKS);
    if (!Number.isInteger(step) || !isApprovableStep(step)) return error("Invalid step", 400);
    if (!isDecisionStatus(status)) return error("'status' must be Approved or Rejected", 400);
    if (status === "Rejected" && !remarks) {
      return error(`Add a remark to reject ${APPROVAL_STEP_LABELS[step] ?? `step ${step}`}.`, 400);
    }
    if (decisions.some((x) => x.step === step)) return error(`Step ${step} is listed twice`, 400);
    decisions.push({ step, status, remarks: remarks || null });
  }
  if (decisions.length === 0) return error("Choose Approve or Reject for at least one step.", 400);

  // Only steps still awaiting a decision can be decided — not ones decided by
  // another selection head a moment ago, nor ones reset by a later change.
  const current = await db
    .select()
    .from(stepApproval)
    .where(
      and(
        eq(stepApproval.tagId, tagId),
        inArray(
          stepApproval.step,
          decisions.map((d) => d.step),
        ),
      ),
    );
  const stale = decisions.filter(
    (d) => current.find((r) => r.step === d.step)?.status !== SENT_APPROVAL_STATUS,
  );
  if (stale.length > 0) {
    return error(
      `${stale.map((d) => APPROVAL_STEP_LABELS[d.step]).join(", ")} ${
        stale.length === 1 ? "is" : "are"
      } no longer awaiting approval — it may have been decided or changed. Reopen the request to see its current state.`,
      409,
    );
  }

  const decidedAt = new Date();
  const deciderId = UUID_RE.test(claims.sub) ? claims.sub : null;
  await db.transaction(async (tx) => {
    for (const d of decisions) {
      await tx
        .update(stepApproval)
        .set({
          status: d.status,
          decidedAt,
          decidedBy: deciderId,
          remarks: d.remarks,
          updatedAt: decidedAt,
        })
        .where(
          and(
            eq(stepApproval.tagId, tagId),
            eq(stepApproval.step, d.step),
            eq(stepApproval.status, SENT_APPROVAL_STATUS),
          ),
        );
    }
  });

  const emailSummary = await notifyEngineers(req, tagId, decisions, current, claims, decidedAt);

  const where = await describeTag(tagId);
  await logAudit(req, {
    action: "approval.decide",
    entity: "step_approval",
    entityId: tagId,
    detail: `${where ? `${where} — ` : ""}${decisions
      .map((d) => `${APPROVAL_STEP_LABELS[d.step]} ${d.status.toLowerCase()}${d.remarks ? ` ("${d.remarks}")` : ""}`)
      .join(", ")}; ${emailSummary}`,
  });

  return json(await loadReview(tagId));
}

/** Emails each engineer who sent the decided steps. Returns the audit wording. */
async function notifyEngineers(
  req: Request,
  tagId: string,
  decisions: { step: number; status: DecisionStatus; remarks: string | null }[],
  rows: (typeof stepApproval.$inferSelect)[],
  claims: { name: string | null; email: string },
  decidedAt: Date,
): Promise<string> {
  try {
    const info = await loadTagInfo(tagId);
    if (!info) return "email skipped (tag not found)";
    // Usually one engineer sent them all; group in case two did.
    const bySender = new Map<string, typeof decisions>();
    for (const d of decisions) {
      const sender = rows.find((r) => r.step === d.step)?.sentBy ?? "";
      bySender.set(sender, [...(bySender.get(sender) ?? []), d]);
    }
    const results: string[] = [];
    for (const [senderId, steps] of bySender) {
      const sender = await userById(senderId);
      if (!sender) {
        results.push("email skipped (sender unknown)");
        continue;
      }
      const mail = decisionEmail({
        to: [sender.email],
        headName: claims.name || claims.email,
        enquiryCode: info.enquiryCode,
        tagName: info.tagName,
        steps: steps.map((d) => ({
          step: d.step,
          label: APPROVAL_STEP_LABELS[d.step] ?? `Step ${d.step}`,
          status: d.status,
          remarks: d.remarks,
        })),
        decidedAt,
        openUrl: `${appBaseUrl(req)}/projects`,
      });
      const result = await sendEmail({
        to: [sender.email],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      results.push(describeEmailResult(result, sender.email));
    }
    return results.join("; ");
  } catch (err) {
    console.error("[approval] couldn't build the decision email", err);
    return "email failed (couldn't build it)";
  }
}
