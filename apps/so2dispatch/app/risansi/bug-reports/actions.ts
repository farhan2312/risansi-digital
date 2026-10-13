"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import {
  BUG_STATUS_LABELS,
  getBugReportOwner,
  insertBugReport,
  updateBugReportStatus,
  type BugStatus,
} from "@/lib/bug-reports";
import { emitToUser } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";

export type SubmitBugResult = { ok: true } | { ok: false; error: string };

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024; // 4MB — keep well under the action-body cap
const VALID_KINDS = new Set(["bug", "feature"]);
const VALID_SEVERITIES = new Set(["Low", "Medium", "High", "Critical"]);

/**
 * Submit a bug or feature report from the in-app widget. Requires a signed-in
 * user (bug reports capture actor identity for follow-up). Optional screenshot
 * is stored inline on the row.
 */
export async function submitBugReportAction(
  formData: FormData
): Promise<SubmitBugResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };

  const kind = String(formData.get("kind") ?? "bug");
  if (!VALID_KINDS.has(kind)) return { ok: false, error: "Invalid kind." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "Please add a short title." };
  if (title.length > 200) {
    return { ok: false, error: "Title is too long (max 200 characters)." };
  }

  const description = String(formData.get("description") ?? "").trim();
  if (description.length > 5000) {
    return {
      ok: false,
      error: "Description is too long (max 5000 characters).",
    };
  }

  const severityRaw = String(formData.get("severity") ?? "").trim();
  const severity =
    severityRaw && VALID_SEVERITIES.has(severityRaw) ? severityRaw : undefined;

  const pagePath = String(formData.get("page_path") ?? "").trim().slice(0, 500);

  const file = formData.get("screenshot");
  let screenshot;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_SCREENSHOT_BYTES) {
      return { ok: false, error: "Screenshot is larger than 4MB." };
    }
    // Only accept image types — refusing arbitrary uploads through this input.
    if (!/^image\//i.test(file.type)) {
      return { ok: false, error: "Screenshot must be an image." };
    }
    const data = Buffer.from(await file.arrayBuffer());
    screenshot = {
      name: file.name || "screenshot.png",
      mimeType: file.type || null,
      size: file.size,
      data,
    };
  }

  try {
    await insertBugReport({
      actor: { id: user.id, email: user.email, role: user.role },
      kind: kind as "bug" | "feature",
      title,
      description: description || undefined,
      severity,
      pagePath: pagePath || undefined,
      screenshot,
    });
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "bug.report",
      category: "activity",
      target: title,
      details: `${kind === "feature" ? "Feature request" : "Bug report"}: ${title}`,
    });
    return { ok: true };
  } catch (error) {
    console.error("submitBugReport failed:", error);
    return { ok: false, error: "Could not submit — please try again." };
  }
}

export type UpdateBugStatusResult = { ok: true } | { ok: false; error: string };

/** Admin-only: move a report through its lifecycle, telling whoever reported it. */
export async function updateBugReportStatusAction(
  id: string,
  status: string
): Promise<UpdateBugStatusResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (user.role !== "admin") {
    return { ok: false, error: "Only the admin can change a report's status." };
  }
  const valid: BugStatus[] = [
    "open",
    "need_clarification",
    "in_progress",
    "resolved",
    "wont_fix",
  ];
  if (!(valid as string[]).includes(status)) {
    return { ok: false, error: "Invalid status." };
  }
  try {
    const before = await getBugReportOwner(id);
    await updateBugReportStatus(id, status as BugStatus);
    // The reporter hears each move, unless they moved it themselves.
    if (before && before.status !== status && before.user_id && before.user_id !== user.id) {
      await emitToUser({
        userId: before.user_id,
        type: "bug_status",
        bugReportId: id,
        message: `Your ${before.title ? `report "${before.title}"` : "bug report"} is now ${BUG_STATUS_LABELS[status as BugStatus]}`,
      });
    }
    revalidatePath("/risansi/bug-reports");
    return { ok: true };
  } catch (error) {
    console.error("updateBugReportStatus failed:", error);
    return { ok: false, error: "Could not update status." };
  }
}
