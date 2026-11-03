/**
 * Server-side helpers for the approval flow, shared by /api/step-approvals
 * (engineer sends), /api/approvals (selection head reviews and decides) and
 * /api/wizard-input (a later change resets a step's approval).
 */
import { and, eq, getTableColumns, inArray, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  driveDirectInput,
  driveGearedInput,
  driveVbeltInput,
  enquiryTags,
  fluidPropertiesInput,
  generalInfoInput,
  mocSealingInput,
  motorDriveInput,
  operatingConditionsInput,
  projects,
  stepApproval,
  users,
} from "@/lib/db/schema";
import type { ApprovalForm } from "@/lib/approval-details";
import { DEFAULT_APPROVAL_STATUS } from "@/lib/approval";

/** Bookkeeping columns every wizard table has; never part of a step's data. */
const NON_FORM_COLUMNS = new Set(["id", "projectId", "tagId", "createdAt", "updatedAt"]);
/** Binary columns: large, and served by their own routes. */
const BINARY_COLUMNS = new Set(["document", "clientRequirementsFile"]);

const WIZARD_TABLES = [
  generalInfoInput,
  fluidPropertiesInput,
  operatingConditionsInput,
  mocSealingInput,
  motorDriveInput,
  driveDirectInput,
  driveVbeltInput,
  driveGearedInput,
];

const asText = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/** Every saved wizard value for a tag as one flat string map — what the
 *  review popup and emails format (lib/approval-details.ts). */
export async function loadTagForm(tagId: string): Promise<ApprovalForm> {
  const form: ApprovalForm = {};
  const rows = await Promise.all(
    WIZARD_TABLES.map((table) => {
      const columns = Object.fromEntries(
        Object.entries(getTableColumns(table)).filter(
          ([k]) => !NON_FORM_COLUMNS.has(k) && !BINARY_COLUMNS.has(k),
        ),
      );
      return db
        .select(columns)
        .from(table)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where(eq((table as any).tagId, tagId))
        .limit(1);
    }),
  );
  for (const [row] of rows) {
    if (!row) continue;
    for (const [k, v] of Object.entries(row)) form[k] = asText(v);
  }
  return form;
}

export interface TagInfo {
  tagId: string;
  tagName: string;
  projectId: string;
  enquiryCode: string;
  projectName: string;
  customerName: string | null;
}

export async function loadTagInfo(tagId: string): Promise<TagInfo | null> {
  const [row] = await db
    .select({
      tagId: enquiryTags.id,
      tagName: enquiryTags.name,
      projectId: projects.id,
      enquiryCode: projects.projectCode,
      projectName: projects.name,
      customerName: projects.customerName,
    })
    .from(enquiryTags)
    .innerJoin(projects, eq(projects.id, enquiryTags.projectId))
    .where(eq(enquiryTags.id, tagId))
    .limit(1);
  return row ?? null;
}

/** "20 m3/hr at 25 MWC" from a tag's values, or "" when either is missing. */
export function dutyText(form: ApprovalForm): string {
  if (!form.capacity || !form.head) return "";
  return `${form.capacity} ${form.capacityUnit || ""} at ${form.head} ${form.headUnit || ""}`
    .replace(/\s+/g, " ")
    .trim();
}

/** Email addresses of every active selection head. */
export async function selectionHeadEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, "selection_head"), eq(users.status, "active")));
  return rows.map((r) => r.email);
}

export async function userById(id: string | null | undefined) {
  if (!id) return null;
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ?? null;
}

/** Where links in emails point. APP_BASE_URL wins (set it in production,
 *  where the request's own origin may be an internal host); otherwise the
 *  origin the request came in on. */
export function appBaseUrl(req: Request): string {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(req.url).origin;
}

/**
 * Sends these steps' approvals back to Pending (still ticked) because their
 * data changed after they were sent or decided. Returns the steps actually
 * reset, so the caller can say so in the audit trail.
 */
export async function resetApprovals(tagId: string, steps: number[]): Promise<number[]> {
  if (steps.length === 0) return [];
  const reset = await db
    .update(stepApproval)
    .set({
      status: DEFAULT_APPROVAL_STATUS,
      sentAt: null,
      sentBy: null,
      decidedAt: null,
      decidedBy: null,
      remarks: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(stepApproval.tagId, tagId),
        inArray(stepApproval.step, steps),
        eq(stepApproval.selected, true),
        ne(stepApproval.status, DEFAULT_APPROVAL_STATUS),
      ),
    )
    .returning({ step: stepApproval.step });
  return reset.map((r) => r.step).sort((a, b) => a - b);
}
