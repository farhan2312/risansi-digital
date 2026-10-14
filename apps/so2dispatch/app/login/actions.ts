"use server";

import { MOVED_TO_HUB } from "@/lib/hub";

export type LoginInput = { email: string; password: string };

export type LoginResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

/**
 * Retired (Phase 5, step 7): this portal no longer signs anybody in or mints
 * its own cookie. Kept, answering with the new address, because a browser
 * still holding the old page's bundle will post here — the server-action
 * equivalent of a 410 rather than a 404.
 */
export async function login(_input: LoginInput): Promise<LoginResult> {
  return { ok: false, error: MOVED_TO_HUB };
}
