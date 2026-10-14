"use server";

import { MOVED_TO_HUB } from "@/lib/hub";

export type RequestAccessInput = {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: string;
};

export type RequestAccessResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Retired (Phase 5, step 7): accounts and access requests are made at Risansi
 * Digital. Answers with the new address for any old bundle still posting here.
 */
export async function requestAccess(_input: RequestAccessInput): Promise<RequestAccessResult> {
  return { ok: false, error: MOVED_TO_HUB };
}
