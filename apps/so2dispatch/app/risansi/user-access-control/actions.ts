"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import {
  createUser,
  deleteUser,
  EmailInUseError,
  getUserById,
  listAccountKeys,
  resetToTemporaryPassword,
  setUserStatus,
  updateUserDetails,
  type UserStatus,
} from "@/lib/users";
import { ALL_ROLES, roleLabel, type Role } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { getRepContact, listRepContacts } from "@/lib/market-intell";
import { listOrderListOptions } from "@/lib/orders";

const PATH = "/risansi/user-access-control";

export type UserActionResult = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

function isPlatformAdmin(email: string | null | undefined): boolean {
  const admin = process.env.ADMIN_EMAIL;
  return !!admin && !!email && email.toLowerCase() === admin.toLowerCase();
}

/** A rep's name and email from the sales portal (Market Intell), to fill a Rep user. Admin only. */
export async function lookupRepContactAction(
  repName: string
): Promise<{ name: string; email: string | null } | null> {
  if (!(await requireAdmin())) return null;
  try {
    return await getRepContact(String(repName ?? ""));
  } catch {
    return null;
  }
}

export type RepAccountCandidate = {
  repName: string;
  fullName: string;
  email: string | null;
  /** ready: can be created; otherwise why not. */
  state: "ready" | "has-account" | "no-email" | "email-in-use";
};

/** Every rep on the orders, with their name and email from the sales portal and whether an account can be made. */
async function repAccountCandidates(): Promise<RepAccountCandidate[]> {
  const [options, keys] = await Promise.all([listOrderListOptions(), listAccountKeys()]);
  const contacts = await listRepContacts(options.reps);
  return options.reps
    .map((repName): RepAccountCandidate => {
      const c = contacts.get(repName.trim().toLowerCase());
      const email = c?.email ?? null;
      const state = keys.repNames.has(repName.trim().toLowerCase())
        ? "has-account"
        : !email
          ? "no-email"
          : keys.emails.has(email.toLowerCase())
            ? "email-in-use"
            : "ready";
      return { repName, fullName: c?.name ?? repName, email, state };
    })
    .sort((a, b) => a.repName.localeCompare(b.repName));
}

export async function listRepAccountCandidatesAction(): Promise<
  { ok: true; reps: RepAccountCandidate[] } | { ok: false; error: string }
> {
  if (!(await requireAdmin())) return { ok: false, error: "Not authorized." };
  try {
    return { ok: true, reps: await repAccountCandidates() };
  } catch (error) {
    console.error("listRepAccountCandidates failed:", error);
    return { ok: false, error: "Could not read the reps from the sales portal." };
  }
}

/**
 * Create Rep accounts for the chosen reps, all on one temporary password the
 * admin types — each Rep replaces it at first sign-in. Names and emails are
 * looked up again here, never taken from the browser.
 */
export async function createRepAccountsAction(
  repNames: string[],
  password: string
): Promise<
  | { ok: true; created: string[]; skipped: { repName: string; reason: string }[] }
  | { ok: false; error: string }
> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };
  if (!password || password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  const wanted = new Set((repNames ?? []).map((n) => String(n).trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return { ok: false, error: "Choose at least one rep." };

  let candidates: RepAccountCandidate[];
  try {
    candidates = await repAccountCandidates();
  } catch (error) {
    console.error("createRepAccounts lookup failed:", error);
    return { ok: false, error: "Could not read the reps from the sales portal." };
  }
  const REASON = {
    "has-account": "Already has an account",
    "no-email": "No email in the sales portal",
    "email-in-use": "Email already used by another user",
  } as const;
  const created: string[] = [];
  const skipped: { repName: string; reason: string }[] = [];
  for (const c of candidates.filter((x) => wanted.has(x.repName.trim().toLowerCase()))) {
    if (c.state !== "ready" || !c.email) {
      skipped.push({ repName: c.repName, reason: c.state === "ready" ? REASON["no-email"] : REASON[c.state] });
      continue;
    }
    try {
      await createUser(
        { fullName: c.fullName, email: c.email, password, role: "rep", repName: c.repName },
        "approved",
        { mustChangePassword: true }
      );
      await logAudit({
        actor: { id: admin.id, email: admin.email, role: admin.role },
        action: "user.create",
        category: "ownership",
        target: c.email,
        details: `Added user ${c.email} (${roleLabel("rep")}: ${c.repName})`,
      });
      created.push(c.repName);
    } catch (error) {
      if (error instanceof EmailInUseError) skipped.push({ repName: c.repName, reason: REASON["email-in-use"] });
      else {
        console.error("createRepAccount failed:", error);
        skipped.push({ repName: c.repName, reason: "Could not be created" });
      }
    }
  }
  revalidatePath(PATH);
  return { ok: true, created, skipped };
}

const VALID_STATUSES: UserStatus[] = [
  "pending",
  "approved",
  "rejected",
  "disabled",
];

export async function setStatusAction(
  id: string,
  status: string
): Promise<UserActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };
  if (!VALID_STATUSES.includes(status as UserStatus)) {
    return { ok: false, error: "Invalid status." };
  }
  const target = await getUserById(id);
  if (!target) return { ok: false, error: "User not found." };
  if (isPlatformAdmin(target.email) && status !== "approved") {
    return { ok: false, error: "The platform admin cannot be deactivated." };
  }

  await setUserStatus(id, status as UserStatus);
  await logAudit({
    actor: { id: admin.id, email: admin.email, role: admin.role },
    action: `user.${status}`,
    category: "ownership",
    target: target.email,
    details: `Set ${target.email} to ${status}`,
  });
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteUserAction(id: string): Promise<UserActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };
  const target = await getUserById(id);
  if (!target) return { ok: false, error: "User not found." };
  if (isPlatformAdmin(target.email)) {
    return { ok: false, error: "The platform admin cannot be deleted." };
  }
  if (target.id === admin.id) {
    return { ok: false, error: "You cannot delete your own account." };
  }

  await deleteUser(id);
  await logAudit({
    actor: { id: admin.id, email: admin.email, role: admin.role },
    action: "user.delete",
    category: "ownership",
    target: target.email,
    details: `Deleted user ${target.email}`,
  });
  revalidatePath(PATH);
  return { ok: true };
}

export type AddUserInput = {
  fullName: string;
  email: string;
  password: string;
  role: string;
  /** A Rep's name as it appears on orders. */
  repName?: string;
};

export async function addUserAction(
  input: AddUserInput
): Promise<UserActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };

  const fullName = input.fullName?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  if (!fullName) return { ok: false, error: "Full name is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: "Enter a valid email address." };
  if (!input.password || input.password.length < 6)
    return { ok: false, error: "Password must be at least 6 characters." };
  if (!ALL_ROLES.includes(input.role as Role))
    return { ok: false, error: "Select a valid role." };
  // A Rep sees only the SOs carrying their name, so the name is required.
  const repName = (input.repName ?? "").trim();
  if (input.role === "rep" && !repName) return { ok: false, error: "Choose the rep this user is." };

  try {
    await createUser(
      { fullName, email, password: input.password, role: input.role as Role, repName },
      "approved",
      // The admin typed a temporary password: the user sets their own on first sign-in.
      { mustChangePassword: true }
    );
    await logAudit({
      actor: { id: admin.id, email: admin.email, role: admin.role },
      action: "user.create",
      category: "ownership",
      target: email,
      details: `Added user ${email} (${roleLabel(input.role)})`,
    });
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    if (error instanceof EmailInUseError) {
      return { ok: false, error: error.message };
    }
    console.error("addUser failed:", error);
    return { ok: false, error: "Could not add the user. Please try again." };
  }
}

export type EditUserInput = {
  fullName: string;
  email: string;
  role: string;
  repName?: string;
};

/**
 * Edit a user's name, email and role in one go. The platform admin keeps its
 * email and role — the email is how the platform recognises it — and nobody
 * changes their own role, which is the one edit that can lock an admin out.
 */
export async function updateUserDetailsAction(
  id: string,
  input: EditUserInput
): Promise<UserActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };
  const target = await getUserById(id);
  if (!target) return { ok: false, error: "User not found." };

  const fullName = input.fullName?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  const role = input.role as Role;
  if (!fullName) return { ok: false, error: "Full name is required." };
  if (fullName.length > 120) return { ok: false, error: "That name is too long." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (!ALL_ROLES.includes(role)) return { ok: false, error: "Select a valid role." };
  const repName = role === "rep" ? (input.repName ?? "").trim() : "";
  if (role === "rep" && !repName) return { ok: false, error: "Choose the rep this user is." };

  const emailChanged = email.toLowerCase() !== target.email.toLowerCase();
  const roleChanged = role !== target.role;
  if (isPlatformAdmin(target.email) && (emailChanged || roleChanged)) {
    return {
      ok: false,
      error: "The platform admin's email and role cannot be changed.",
    };
  }
  if (target.id === admin.id && roleChanged) {
    return { ok: false, error: "You cannot change your own role." };
  }

  // What changed, for the audit trail — and nothing to write if it's nothing.
  const changes: string[] = [];
  if (fullName !== target.full_name) changes.push(`Name: ${target.full_name} → ${fullName}`);
  if (email !== target.email) changes.push(`Email: ${target.email} → ${email}`);
  if (roleChanged) changes.push(`Role: ${roleLabel(target.role)} → ${roleLabel(role)}`);
  if (repName !== (target.rep_name ?? "")) changes.push(`Rep: ${target.rep_name || "—"} → ${repName || "—"}`);
  if (changes.length === 0) return { ok: true };

  try {
    await updateUserDetails(id, { fullName, email, role, repName });
  } catch (error) {
    if (error instanceof EmailInUseError) {
      return { ok: false, error: "Another account already uses that email." };
    }
    console.error("updateUserDetails failed:", error);
    return { ok: false, error: "Could not save the changes. Please try again." };
  }

  await logAudit({
    actor: { id: admin.id, email: admin.email, role: admin.role },
    action: "user.update",
    category: "ownership",
    target: email,
    details: `Edited ${target.email} — ${changes.join("; ")}`,
  });
  revalidatePath(PATH);
  return { ok: true };
}

// No 0/O, 1/l/I: the password is read out or copied by hand.
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** 12 characters from a CSPRNG, always with a digit and both letter cases. */
function temporaryPassword(): string {
  const pick = (from: string) => from[randomInt(from.length)];
  for (;;) {
    const candidate = Array.from({ length: 12 }, () => pick(PASSWORD_ALPHABET)).join("");
    if (/[A-Z]/.test(candidate) && /[a-z]/.test(candidate) && /[0-9]/.test(candidate)) {
      return candidate;
    }
    // A draw missing a class is rare; draw again rather than patch one in,
    // which would make that position predictable.
  }
}

export type ResetPasswordResult =
  | { ok: true; temporaryPassword: string }
  | { ok: false; error: string };

/**
 * Put a user on a fresh temporary password. It is returned once, for the
 * admin to hand over, and never stored anywhere but as a hash. The user must
 * set their own at their next sign-in, and every session they already had
 * ends — so a reset also shuts out anyone holding a stolen session.
 *
 * Not for your own account (use Change password), and not for the platform
 * admin: a reset puts the account in the hands of whoever issued it until the
 * user signs in, and the platform admin must never be taken over that way.
 */
export async function resetPasswordAction(id: string): Promise<ResetPasswordResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };
  const target = await getUserById(id);
  if (!target) return { ok: false, error: "User not found." };
  if (target.id === admin.id) {
    return { ok: false, error: "Use Change password for your own account." };
  }
  if (isPlatformAdmin(target.email)) {
    return { ok: false, error: "The platform admin's password cannot be reset here." };
  }

  const password = temporaryPassword();
  try {
    await resetToTemporaryPassword(id, password);
  } catch (error) {
    console.error("resetPassword failed:", error);
    return { ok: false, error: "Could not reset the password. Please try again." };
  }

  // The password itself is never logged.
  await logAudit({
    actor: { id: admin.id, email: admin.email, role: admin.role },
    action: "user.password_reset",
    category: "ownership",
    target: target.email,
    details: `Reset the password for ${target.email} — signed out everywhere; must set a new one at next sign-in`,
  });
  revalidatePath(PATH);
  return { ok: true, temporaryPassword: password };
}
