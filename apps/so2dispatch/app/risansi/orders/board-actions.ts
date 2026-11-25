"use server";

import { getCurrentUser } from "@/lib/session";
import { canViewAll } from "@/lib/roles";
import { mayOpenPage } from "@/lib/view-pages";
import { boardFilterOf, loadDeptBoard } from "@/lib/dept-board";
import type { BoardData } from "@/lib/dept-board-keys";

/** The department board for the Orders page's filter (its query string). Read only. */
export async function loadDeptBoardAction(qs: string): Promise<{ ok: true; data: BoardData } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || !canViewAll(user.role) || !mayOpenPage(user, "/risansi/orders")) return { ok: false, error: "Not allowed." };
  try {
    const params = new URLSearchParams(qs);
    const filter = boardFilterOf(user, (k) => params.get(k) ?? undefined);
    return { ok: true, data: await loadDeptBoard(filter) };
  } catch (e) {
    console.error("loadDeptBoardAction failed:", e);
    return { ok: false, error: "Could not load the department board." };
  }
}
