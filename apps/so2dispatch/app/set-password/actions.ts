"use server";

import { MOVED_TO_HUB } from "@/lib/hub";

export type SetPasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Retired (Phase 5, step 7): passwords are changed at Risansi Digital, and
 * whether one is owed is read from the shared session. Answers with the new
 * address for any old bundle still posting here.
 */
export async function forceSetPassword(_input: {
  newPassword: string;
  confirmPassword: string;
}): Promise<SetPasswordResult> {
  return { ok: false, error: MOVED_TO_HUB };
}
