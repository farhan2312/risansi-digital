import { and, asc, eq, inArray } from "drizzle-orm";

import { error, json } from "@/lib/api";
import {
  APPROVABLE_STEPS,
  APPROVAL_STEP_LABELS,
  DEFAULT_APPROVAL_STATUS,
  SENDABLE_STATUSES,
  SENT_APPROVAL_STATUS,
  isApprovableStep,
  isLockedStatus,
  type ApprovalStatus,
} from "@/lib/approval";
import { approvalStepHighlights } from "@/lib/approval-details";
import {
  appBaseUrl,
  dutyText,
  loadTagForm,
  loadTagInfo,
  selectionHeadEmails,
} from "@/lib/approval-server";
import { AuthError, decodeToken } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enquiryTags, stepApproval, users } from "@/lib/db/schema";
import { requestEmail } from "@/lib/email/approval-emails";
import { describeEmailResult, sendEmail } from "@/lib/email/resend";

export const dynamic = "force-dynamic";

// Per-step approval for one tag's wizard.
//
//   GET  ?tagId=…            every approval row for the tag
//   PUT  {tagId, step, selected}   tick/untick one step
//   POST {tagId}             send every ticked, still-Pending step
//
// Separate from /api/wizard-input/[table] because those tables hold exactly
// one row per tag, while this one holds up to seven (one per approvable step).
// Any authenticated user runs the wizard, so these gate on decodeToken.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = typeof stepApproval.$inferSelect;

const toDict = (r: Row, decidedByName: string | null = null) => ({
  step: r.step,
  selected: r.selected,
  status: r.status as ApprovalStatus,
  sentAt: r.sentAt ? r.sentAt.toISOString() : null,
  decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  decidedByName,
  remarks: r.remarks,
});

/** Every approval row for a tag, with the decider's name for "Rejected by …". */
async function listForTag(tagId: string) {
  const rows = await db
    .select({ row: stepApproval, decidedByName: users.name, decidedByEmail: users.email })
    .from(stepApproval)
    .leftJoin(users, eq(users.id, stepApproval.decidedBy))
    .where(eq(stepApproval.tagId, tagId))
    .orderBy(asc(stepApproval.step));
  return rows.map((r) => toDict(r.row, r.decidedByName || r.decidedByEmail || null));
}

/** Resolve + validate the tag, so a caller can't write approvals against a
 * tag id that doesn't exist (the FK would reject it anyway, with a 500). */
async function loadTag(tagId: string) {
  const [tag] = await db
    .select()
    .from(enquiryTags)
    .where(eq(enquiryTags.id, tagId))
    .limit(1);
  return tag ?? null;
}

export async function GET(req: Request) {
  try {
    decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const tagId = new URL(req.url).searchParams.get("tagId");
  if (!tagId || !UUID_RE.test(tagId)) {
    return error("'tagId' query param is required and must be a uuid", 400);
  }

  return json(await listForTag(tagId));
}

export async function PUT(req: Request) {
  try {
    decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const tagId = String(body.tagId ?? "");
  if (!UUID_RE.test(tagId)) return error("'tagId' is required and must be a uuid", 400);

  const step = Number(body.step);
  if (!Number.isInteger(step) || !isApprovableStep(step)) {
    return error(`'step' must be one of: ${APPROVABLE_STEPS.join(", ")}`, 400);
  }

  const selected = Boolean(body.selected);

  const tag = await loadTag(tagId);
  if (!tag) return error("Tag not found", 404);

  // A step awaiting a decision, or approved, can't be withdrawn: a selection
  // head has been asked to look at it (or already signed it off). The
  // Approval step locks its box, but enforce it here too. A rejected step can
  // be unticked - it has been handed back.
  if (!selected) {
    const [existing] = await db
      .select({ selected: stepApproval.selected, status: stepApproval.status })
      .from(stepApproval)
      .where(and(eq(stepApproval.tagId, tagId), eq(stepApproval.step, step)))
      .limit(1);
    if (existing?.selected && isLockedStatus(existing.status)) {
      return error("This step has already been sent for approval and can't be withdrawn.", 409);
    }
  }

  // Un-ticking resets the row to Pending as well as clearing the tick: the
  // step is no longer up for approval at all, so leaving "Awaiting Approval"
  // behind would misreport it on the Approval step if it were re-ticked.
  const [row] = await db
    .insert(stepApproval)
    .values({
      projectId: tag.projectId,
      tagId,
      step,
      selected,
      status: DEFAULT_APPROVAL_STATUS,
    })
    .onConflictDoUpdate({
      target: [stepApproval.tagId, stepApproval.step],
      set: selected
        ? { selected: true, updatedAt: new Date() }
        : {
            selected: false,
            status: DEFAULT_APPROVAL_STATUS,
            sentAt: null,
            sentBy: null,
            updatedAt: new Date(),
          },
    })
    .returning();

  await logAudit(req, {
    action: "approval.select",
    entity: "step_approval",
    entityId: row.id,
    detail: `${tag.name}: step ${step} ${selected ? "marked for" : "removed from"} approval`,
  });

  return json(toDict(row));
}

export async function POST(req: Request) {
  let claims;
  try {
    claims = decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const tagId = String(body.tagId ?? "");
  if (!UUID_RE.test(tagId)) return error("'tagId' is required and must be a uuid", 400);

  const tag = await loadTag(tagId);
  if (!tag) return error("Tag not found", 404);

  const pending = await db
    .select()
    .from(stepApproval)
    .where(
      and(
        eq(stepApproval.tagId, tagId),
        eq(stepApproval.selected, true),
        inArray(stepApproval.status, [...SENDABLE_STATUSES]),
      ),
    );

  if (pending.length === 0) {
    return error("No steps are selected and pending approval.", 400);
  }

  // Pending and Rejected steps move; a step already Awaiting Approval or
  // Approved is left alone, so re-sending can't reset a decision or overwrite
  // the original sent-at stamp. A rejected step being sent again starts a
  // fresh request, so its old decision is cleared (the audit trail keeps it).
  const sentAt = new Date();
  await db
    .update(stepApproval)
    .set({
      status: SENT_APPROVAL_STATUS,
      sentAt,
      sentBy: UUID_RE.test(claims.sub) ? claims.sub : null,
      decidedAt: null,
      decidedBy: null,
      remarks: null,
      updatedAt: sentAt,
    })
    .where(
      inArray(
        stepApproval.id,
        pending.map((r) => r.id),
      ),
    );

  const sentSteps = pending.map((r) => r.step).sort((a, b) => a - b);

  // Email every selection head — after the rows are committed, so a mail
  // failure can never leave the steps un-sent. sendEmail never throws.
  const emailResult = await notifySelectionHeads(req, tagId, sentSteps, claims, sentAt);

  await logAudit(req, {
    action: "approval.send",
    entity: "step_approval",
    entityId: tagId,
    detail: `${tag.name}: sent ${pending.length} step(s) for approval — ${sentSteps.join(", ")}; ${emailResult}`,
  });

  return json({ sent: pending.length, approvals: await listForTag(tagId) });
}

/** Builds and sends the "approval needed" email. Returns the audit wording. */
async function notifySelectionHeads(
  req: Request,
  tagId: string,
  steps: number[],
  claims: { sub: string; name: string | null; email: string },
  sentAt: Date,
): Promise<string> {
  try {
    const [info, form, to] = await Promise.all([
      loadTagInfo(tagId),
      loadTagForm(tagId),
      selectionHeadEmails(),
    ]);
    if (!info) return "email skipped (tag not found)";
    const mail = requestEmail({
      to,
      engineerName: claims.name || claims.email,
      enquiryCode: info.enquiryCode,
      projectName: info.projectName,
      customerName: info.customerName,
      tagName: info.tagName,
      pumpModel: form.selectedModel,
      duty: dutyText(form),
      steps: steps.map((s) => ({
        step: s,
        label: APPROVAL_STEP_LABELS[s] ?? `Step ${s}`,
        highlights: approvalStepHighlights(s, form),
      })),
      sentAt,
      reviewUrl: `${appBaseUrl(req)}/approvals?tag=${encodeURIComponent(tagId)}`,
    });
    const result = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    return describeEmailResult(
      result,
      `${to.length} selection head${to.length === 1 ? "" : "s"}`,
    );
  } catch (err) {
    console.error("[approval] couldn't build the request email", err);
    return "email failed (couldn't build it)";
  }
}
