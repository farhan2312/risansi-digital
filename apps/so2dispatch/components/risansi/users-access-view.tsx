"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2, Plus, Users, X } from "lucide-react";
import {
  UrlPagination,
  UrlSearchInput,
  UrlTabs,
} from "./url-table";
import type { PageResult } from "@/lib/pagination";
import { ALL_ROLES, roleLabel } from "@/lib/roles";
import type { User, UserListRow, UserStatus } from "@/lib/users";
import {
  addUserAction,
  createRepAccountsAction,
  deleteUserAction,
  listRepAccountCandidatesAction,
  lookupRepContactAction,
  resetPasswordAction,
  setStatusAction,
  updateUserDetailsAction,
} from "@/app/risansi/user-access-control/actions";
import { ConfirmDialog } from "./confirm-dialog";

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

const REVIEW_WORD: Record<string, string> = {
  approved: "Approved",
  rejected: "Rejected",
  disabled: "Disabled",
  pending: "Set to pending",
};

/**
 * Who brought the user in — an admin adding them, or their own request — and
 * who last decided their access. Read off the audit log.
 */
function Provenance({ u }: { u: UserListRow }) {
  if (!u.origin && !u.review) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-0.5 text-xs leading-tight">
      {u.origin && (
        <div>
          <span className="text-muted">
            {u.origin === "added" ? "Added by " : "Requested access"}
          </span>
          {u.origin === "added" && (
            <span className="font-medium text-foreground">{u.origin_by ?? "—"}</span>
          )}
          {u.origin_at && <span className="text-muted"> · {shortDate(u.origin_at)}</span>}
        </div>
      )}
      {u.review && (
        <div>
          <span className="text-muted">{REVIEW_WORD[u.review] ?? u.review} by </span>
          <span className="font-medium text-foreground">{u.review_by ?? "—"}</span>
          {u.review_at && <span className="text-muted"> · {shortDate(u.review_at)}</span>}
        </div>
      )}
    </div>
  );
}

const STATUS_STYLES: Record<UserStatus, string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  disabled: "bg-gray-100 text-gray-600 ring-gray-200",
};

function StatusChip({ status }: { status: UserStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  tone,
  busy,
}: {
  label: string;
  onClick: () => void;
  tone: "primary" | "danger" | "neutral" | "warn";
  busy?: boolean;
}) {
  const cls =
    tone === "primary"
      ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
      : tone === "danger"
        ? "border-rose-200 text-rose-600 hover:bg-rose-50"
        : tone === "warn"
          ? "border-amber-200 text-amber-700 hover:bg-amber-50"
          : "border-input-border text-foreground hover:bg-background";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${cls}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : label}
    </button>
  );
}

export function UsersAccessView({
  result,
  currentEmail,
  platformAdminEmail,
  repNames = [],
}: {
  // One server-fetched page, plus per-status totals for the whole table.
  result: PageResult<UserListRow> & { counts: Record<string, number> };
  currentEmail: string;
  platformAdminEmail: string;
  // The rep names on orders, for linking a Rep user.
  repNames?: string[];
}) {
  const router = useRouter();
  const users = result.rows;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showRepBulk, setShowRepBulk] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);

  // Filtering and paging happen in SQL now — these are just the totals the
  // header and the tabs display.
  const pageRows = users;
  const activeCount = result.counts.approved ?? 0;

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(id);
    const res = await fn();
    setBusyId(null);
    if (!res.ok && res.error) alert(res.error);
    else router.refresh();
  }

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          Users &amp; Access
        </h1>
        <p className="text-sm text-muted">
          {result.counts.all ?? 0} users · {activeCount} active
        </p>
      </div>

      {/* toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <UrlSearchInput placeholder="Search name, email, role…" />
        <UrlTabs
          paramKey="status"
          fallback="all"
          options={[
            { value: "all", label: "All", count: result.counts.all ?? 0 },
            { value: "pending", label: "Pending", count: result.counts.pending ?? 0 },
            { value: "approved", label: "Approved", count: result.counts.approved ?? 0 },
            { value: "rejected", label: "Rejected", count: result.counts.rejected ?? 0 },
            { value: "disabled", label: "Disabled", count: result.counts.disabled ?? 0 },
          ]}
        />
        <button
          type="button"
          onClick={() => setShowRepBulk(true)}
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-input-border bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background"
        >
          <Users className="h-4 w-4" />
          Create Rep accounts
        </button>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" />
          Add User
        </button>
      </div>

      <div className="rounded-xl border border-card-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Added / Reviewed by</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted">
                    No users match your filters.
                  </td>
                </tr>
              )}
              {pageRows.map((u) => {
                const isProtected =
                  u.email.toLowerCase() === platformAdminEmail.toLowerCase();
                const isSelf = u.email.toLowerCase() === currentEmail.toLowerCase();
                const busy = busyId === u.id;
                return (
                  <tr key={u.id} className="text-foreground">
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.full_name}</div>
                      <div className="text-xs text-muted">{u.email}</div>
                      {u.must_change_password && (
                        <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          <KeyRound className="h-3 w-3" />
                          On a temporary password
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {roleLabel(u.role)}
                        {u.role === "rep" && u.rep_name ? ` · ${u.rep_name}` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={u.status} />
                    </td>
                    <td className="px-4 py-3">
                      {u.status === "approved" ? (
                        <span className="font-medium text-emerald-600">Yes</span>
                      ) : (
                        <span className="text-muted">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Provenance u={u} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {(u.status === "pending" || u.status === "rejected") && (
                          <ActionButton
                            label="Approve"
                            tone="primary"
                            busy={busy}
                            onClick={() =>
                              run(u.id, () => setStatusAction(u.id, "approved"))
                            }
                          />
                        )}
                        {u.status === "pending" && !isProtected && (
                          <ActionButton
                            label="Reject"
                            tone="danger"
                            busy={busy}
                            onClick={() =>
                              run(u.id, () => setStatusAction(u.id, "rejected"))
                            }
                          />
                        )}
                        {u.status === "approved" && !isProtected && (
                          <ActionButton
                            label="Deactivate"
                            tone="warn"
                            busy={busy}
                            onClick={() =>
                              run(u.id, () => setStatusAction(u.id, "disabled"))
                            }
                          />
                        )}
                        {u.status === "disabled" && (
                          <ActionButton
                            label="Activate"
                            tone="primary"
                            busy={busy}
                            onClick={() =>
                              run(u.id, () => setStatusAction(u.id, "approved"))
                            }
                          />
                        )}
                        <ActionButton
                          label="Edit"
                          tone="neutral"
                          onClick={() => setEditUser(u)}
                        />
                        {!isProtected && !isSelf && (
                          <ActionButton
                            label="Delete"
                            tone="danger"
                            busy={busy}
                            onClick={() => {
                              if (
                                confirm(`Delete ${u.email}? This cannot be undone.`)
                              )
                                run(u.id, () => deleteUserAction(u.id));
                            }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <UrlPagination
          page={result.page}
          totalPages={result.totalPages}
          from={result.from}
          to={result.to}
          total={result.total}
        />
      </div>

      {showAdd && <AddUserModal repNames={repNames} onClose={() => setShowAdd(false)} />}
      {showRepBulk && <RepAccountsModal onClose={() => setShowRepBulk(false)} />}
      {editUser && (
        <EditUserModal
          user={editUser}
          isProtected={
            editUser.email.toLowerCase() === platformAdminEmail.toLowerCase()
          }
          isSelf={editUser.email.toLowerCase() === currentEmail.toLowerCase()}
          repNames={repNames}
          onClose={() => setEditUser(null)}
        />
      )}
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-[10px] border border-input-border bg-surface px-[15px] text-[14px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";
const labelClass = "mb-1.5 block text-[13px] font-semibold text-brand-label";

type RepCandidate = Extract<Awaited<ReturnType<typeof listRepAccountCandidatesAction>>, { ok: true }>["reps"][number];

const REP_STATE_LABEL: Record<RepCandidate["state"], string> = {
  ready: "",
  "has-account": "Has an account",
  "no-email": "No email in sales portal",
  "email-in-use": "Email used by another user",
};

/**
 * Every rep on the orders without an account yet, with name and email from
 * the sales portal: tick them, type one temporary password, create them all.
 */
function RepAccountsModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [reps, setReps] = useState<RepCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ created: string[]; skipped: { repName: string; reason: string }[] } | null>(null);

  useEffect(() => {
    let live = true;
    void listRepAccountCandidatesAction().then((r) => {
      if (!live) return;
      if (!r.ok) return setLoadError(r.error);
      setReps(r.reps);
      setPicked(new Set(r.reps.filter((x) => x.state === "ready").map((x) => x.repName)));
    });
    return () => {
      live = false;
    };
  }, []);

  function toggle(name: string) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!picked.size) return setError("Tick at least one rep.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("The passwords don't match.");
    setSaving(true);
    const r = await createRepAccountsAction([...picked], password);
    setSaving(false);
    if (!r.ok) return setError(r.error);
    setPassword("");
    setConfirm("");
    setResult({ created: r.created, skipped: r.skipped });
    router.refresh();
  }

  const ready = reps?.filter((x) => x.state === "ready").length ?? 0;
  return (
    <ModalShell title="Create Rep accounts" onClose={onClose}>
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            <span className="font-semibold text-emerald-700">{result.created.length} created</span>
            {result.skipped.length > 0 && <> · {result.skipped.length} skipped</>}. Each Rep sets their own password at first sign-in.
          </p>
          {result.created.length > 0 && (
            <ul className="rounded-lg border border-card-border bg-background p-3 text-sm text-foreground">
              {result.created.map((n) => (
                <li key={n} className="flex items-center gap-1.5 py-0.5">
                  <Check className="h-3.5 w-3.5 text-emerald-600" /> {n}
                </li>
              ))}
            </ul>
          )}
          {result.skipped.length > 0 && (
            <ul className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {result.skipped.map((s) => (
                <li key={s.repName} className="py-0.5">
                  {s.repName} — {s.reason}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-full rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <p className="-mt-3 mb-4 text-sm text-muted">
            Reps on the orders, with name and email from the sales portal. They sign in read-only and see only their own SOs.
          </p>
          {loadError ? (
            <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{loadError}</p>
          ) : !reps ? (
            <p className="mb-4 flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking up the sales portal…
            </p>
          ) : (
            <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-card-border">
              {reps.map((r) => {
                const can = r.state === "ready";
                return (
                  <label
                    key={r.repName}
                    className={`flex items-start gap-2.5 border-b border-card-border px-3 py-2 last:border-b-0 ${
                      can ? "cursor-pointer hover:bg-background" : "opacity-60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-primary"
                      disabled={!can}
                      checked={can && picked.has(r.repName)}
                      onChange={() => toggle(r.repName)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{r.fullName}</span>
                      <span className="block truncate text-xs text-muted">{r.email ?? "—"}</span>
                    </span>
                    {!can && <span className="shrink-0 text-xs text-muted">{REP_STATE_LABEL[r.state]}</span>}
                  </label>
                );
              })}
            </div>
          )}
          <label className={labelClass}>Temporary password</label>
          <input
            className={`${inputClass} mb-4`}
            type="password"
            autoComplete="new-password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label className={labelClass}>Confirm password</label>
          <input
            className={`${inputClass} mb-4`}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-[10px] border border-input-border bg-surface text-sm font-medium text-foreground transition-colors hover:bg-background"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !reps || !picked.size}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Creating…" : reps && !ready ? "Nothing to create" : `Create ${picked.size} account${picked.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}

function AddUserModal({ onClose, repNames }: { onClose: () => void; repNames: string[] }) {
  const router = useRouter();
  const [values, setValues] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "",
    repName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await addUserAction(values);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <ModalShell title="Add user" onClose={onClose}>
      <form onSubmit={submit}>
        {error && (
          <div className="mb-4 rounded-[10px] border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}
        <label className={labelClass}>Full name</label>
        <div className="mb-4">
          <input
            className={inputClass}
            value={values.fullName}
            onChange={(e) => setValues((v) => ({ ...v, fullName: e.target.value }))}
            placeholder="Jane Cooper"
          />
        </div>
        <label className={labelClass}>Email</label>
        <div className="mb-4">
          <input
            className={inputClass}
            type="email"
            value={values.email}
            onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
            placeholder="you@company.com"
          />
        </div>
        <label className={labelClass}>Temporary password</label>
        <div className="mb-4">
          <input
            className={inputClass}
            type="text"
            value={values.password}
            onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            placeholder="At least 6 characters"
          />
        </div>
        <label className={labelClass}>Role</label>
        <div className="mb-6">
          <select
            className={`${inputClass} cursor-pointer`}
            value={values.role}
            onChange={(e) => setValues((v) => ({ ...v, role: e.target.value }))}
          >
            <option value="">Select a role</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </div>
        {values.role === "rep" && (
          <RepPicker
            value={values.repName}
            repNames={repNames}
            onChange={(repName) => setValues((v) => ({ ...v, repName }))}
            onContact={(c) => setValues((v) => ({ ...v, fullName: c.name, email: c.email ?? v.email }))}
          />
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-[10px] border border-input-border bg-surface text-sm font-medium text-foreground transition-colors hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-70"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Adding…" : "Add user"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * Edit a user's name, email and role, and — in its own section — reset their
 * password. What cannot change for this user is shown locked with the reason,
 * rather than hidden, so it doesn't look like a missing feature.
 */
function EditUserModal({
  user,
  isProtected,
  isSelf,
  repNames,
  onClose,
}: {
  user: User;
  isProtected: boolean;
  isSelf: boolean;
  repNames: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    fullName: user.full_name,
    email: user.email,
    role: user.role as string,
    repName: user.rep_name ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const emailLocked = isProtected;
  const roleLocked = isProtected || isSelf;
  const canReset = !isProtected && !isSelf;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await updateUserDetailsAction(user.id, values);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  async function reset() {
    setResetting(true);
    setResetError(null);
    const res = await resetPasswordAction(user.id);
    setResetting(false);
    setConfirmReset(false);
    if (!res.ok) {
      setResetError(res.error);
      return;
    }
    setTempPassword(res.temporaryPassword);
    router.refresh();
  }

  async function copy() {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the password is on screen to copy by hand.
    }
  }

  const lockHint = "mt-1 text-[11px] text-muted-foreground";

  return (
    <ModalShell title={`Edit user — ${user.full_name}`} onClose={onClose}>
      {tempPassword ? (
        // Shown once: the password exists nowhere else in plain text.
        <div>
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <Check className="h-4 w-4" />
            Password reset for {user.email}
          </div>
          <label className={labelClass}>Temporary password</label>
          <div className="mb-3 flex items-center gap-2">
            <code className="flex h-11 flex-1 select-all items-center rounded-[10px] border border-input-border bg-background px-3 font-mono text-base tracking-wider text-foreground">
              {tempPassword}
            </code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-input-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <ul className="mb-6 space-y-1 text-[13px] text-muted">
            <li>• Share it with {user.full_name} directly — it will not be shown again.</li>
            <li>• They have been signed out everywhere.</li>
            <li>• At their next sign-in they must set a password of their own.</li>
          </ul>
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-full rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={submit}>
            {error && (
              <div className="mb-4 rounded-[10px] border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger">
                {error}
              </div>
            )}
            <label className={labelClass}>Full name</label>
            <div className="mb-4">
              <input
                className={inputClass}
                value={values.fullName}
                onChange={(e) => setValues((v) => ({ ...v, fullName: e.target.value }))}
              />
            </div>
            <label className={labelClass}>Email</label>
            <div className="mb-4">
              <input
                className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
                type="email"
                value={values.email}
                disabled={emailLocked}
                onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
              />
              {emailLocked && (
                <p className={lockHint}>The platform admin&apos;s email is fixed.</p>
              )}
            </div>
            <label className={labelClass}>Role</label>
            <div className="mb-6">
              <select
                className={`${inputClass} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
                value={values.role}
                disabled={roleLocked}
                onChange={(e) => setValues((v) => ({ ...v, role: e.target.value }))}
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
              {roleLocked && (
                <p className={lockHint}>
                  {isProtected
                    ? "The platform admin's role is fixed."
                    : "You cannot change your own role."}
                </p>
              )}
            </div>
            {values.role === "rep" && (
              <RepPicker
                value={values.repName}
                repNames={repNames}
                onChange={(repName) => setValues((v) => ({ ...v, repName }))}
                onContact={(c) =>
                  setValues((v) => ({ ...v, fullName: c.name, email: emailLocked ? v.email : (c.email ?? v.email) }))
                }
              />
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="h-11 flex-1 rounded-[10px] border border-input-border bg-surface text-sm font-medium text-foreground transition-colors hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-70"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>

          <div className="mt-6 border-t border-card-border pt-5">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <KeyRound className="h-4 w-4 text-primary" />
              Password
            </h3>
            {canReset ? (
              <>
                <p className="mb-3 text-[13px] text-muted">
                  Issue a temporary password. {user.full_name} is signed out
                  everywhere and must choose a new password at next sign-in.
                </p>
                {resetError && (
                  <div className="mb-3 rounded-[10px] border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger">
                    {resetError}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-amber-200 px-4 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50"
                >
                  <KeyRound className="h-4 w-4" />
                  Reset password
                </button>
              </>
            ) : (
              <p className="text-[13px] text-muted">
                {isSelf
                  ? "To change your own password, use Change password in your profile menu."
                  : "The platform admin's password cannot be reset from here."}
              </p>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Reset this password?"
        message={`${user.full_name} (${user.email}) will be signed out everywhere and given a temporary password.`}
        detail="Their current password stops working immediately. You'll see the temporary password once, to share with them."
        confirmLabel="Reset password"
        tone="danger"
        busy={resetting}
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-card-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:p-6 sm:pb-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="mb-5 font-display text-lg font-semibold text-foreground">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Which rep a Rep user is: the name as it appears on orders. They see only
 * those SOs. Picking one fills the name and email from the sales portal.
 */
function RepPicker({
  value,
  repNames,
  onChange,
  onContact,
}: {
  value: string;
  repNames: string[];
  onChange: (next: string) => void;
  onContact: (contact: { name: string; email: string | null }) => void;
}) {
  const [looking, setLooking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const names = [...new Set([...repNames, ...(value ? [value] : [])])].sort((a, b) => a.localeCompare(b));
  async function pick(next: string) {
    onChange(next);
    setNote(null);
    if (!next) return;
    setLooking(true);
    const c = await lookupRepContactAction(next);
    setLooking(false);
    if (c) {
      onContact(c);
      setNote(c.email ? "Name and email filled from the sales portal." : "Name filled; no email in the sales portal.");
    } else {
      onContact({ name: next, email: null });
      setNote("Not found in the sales portal — enter the email.");
    }
  }
  return (
    <>
      <label className={labelClass}>Rep</label>
      <div className="mb-6">
        <select className={`${inputClass} cursor-pointer`} value={value} onChange={(e) => void pick(e.target.value)}>
          <option value="">Select the rep</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-muted">They see only the SOs whose Rep is this name — read-only.</p>
        {(looking || note) && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-primary">
            {looking && <Loader2 className="h-3 w-3 animate-spin" />}
            {looking ? "Looking up the sales portal…" : note}
          </p>
        )}
      </div>
    </>
  );
}
