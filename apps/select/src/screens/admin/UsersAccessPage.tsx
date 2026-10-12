"use client";

import { useEffect, useMemo, useState } from "react";
import "../pump-model-master/PumpModelMasterPage.css";
import "./UsersAccessPage.css";
import {
  createUser,
  deleteUser,
  listAllUsers,
  reviewUser,
  updateUser,
  type PendingUser,
  type UserRole,
  type UserStatus,
} from "../../services/adminService";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import EmptyState from "../../components/ui/EmptyState";
import { SkeletonRows } from "../../components/ui/Skeleton";
import Spinner from "../../components/ui/Spinner";
import ConfirmModal from "../../components/ui/ConfirmModal";
import Pagination, { usePagination } from "../../components/ui/Pagination";
import {
  PlusIcon,
  SearchIcon,
  EditIcon,
  TrashIcon,
  AlertIcon,
  CheckIcon,
  XIcon,
  PauseIcon,
  PlayIcon,
} from "../../components/ui/adminIcons";

// Order is the dropdown order. Selection Head = User access plus deciding
// approvals (lib/approval.ts APPROVER_ROLES). Pulley Owner = User access plus
// the Pulley Master page (lib/auth.ts PULLEY_MASTER_ROLES).
const ROLE_LABELS: Record<UserRole, string> = {
  user: "User",
  selection_head: "Selection Head",
  pulley_owner: "Pulley Owner",
  admin: "Admin",
  system_admin: "System Admin",
};
/** "Asad Shakri" -> "AS"; falls back to the email's local part. */
const initialsOf = (name: string | null, email: string): string => {
  const parts = (name || email.split("@")[0] || "?").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
};

/** A stable hue per person, so each avatar keeps its colour. */
const avatarHue = (email: string): number => {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [212, 190, 160, 262, 330, 28, 142, 0][h % 8]!;
};

const STATUS_LABELS: Record<UserStatus, string> = {
  pending: "Pending",
  active: "Active",
  rejected: "Rejected",
  deactivated: "Deactivated",
};
const STATUS_FILTERS: { value: UserStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "rejected", label: "Rejected" },
  { value: "deactivated", label: "Deactivated" },
];

const errorMessage = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const UsersAccessPage = () => {
  const { user: me } = useCurrentUser();

  const [users, setUsers] = useState<PendingUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");

  const [actioningId, setActioningId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editRow, setEditRow] = useState<PendingUser | null>(null);
  const [deleteRow, setDeleteRow] = useState<PendingUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setIsLoading(true);
    setError(null);
    listAllUsers()
      .then(setUsers)
      .catch(() => setError("Couldn't load users."))
      .finally(() => setIsLoading(false));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (u.name ?? "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        ROLE_LABELS[u.role].toLowerCase().includes(q)
      );
    });
  }, [users, search, statusFilter]);

  const { page, setPage, from, to, pageSize } = usePagination(
    filtered.length,
    `${statusFilter}:${search}`,
    50,
  );
  const paged = useMemo(() => filtered.slice(from, to), [filtered, from, to]);

  const activeCount = useMemo(() => users.filter((u) => u.status === "active").length, [users]);

  const applyUpdate = (updated: PendingUser) =>
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));

  const handleReview = async (id: string, status: "active" | "rejected") => {
    setActioningId(id);
    setError(null);
    try {
      applyUpdate(await reviewUser(id, status));
    } catch (err) {
      setError(errorMessage(err, "Couldn't update this request."));
    } finally {
      setActioningId(null);
    }
  };

  const handleToggleActive = async (row: PendingUser) => {
    setActioningId(row.id);
    setError(null);
    try {
      applyUpdate(
        await updateUser(row.id, { status: row.status === "active" ? "deactivated" : "active" }),
      );
    } catch (err) {
      setError(errorMessage(err, "Couldn't update this user."));
    } finally {
      setActioningId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteRow) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteUser(deleteRow.id);
      setUsers((prev) => prev.filter((u) => u.id !== deleteRow.id));
      setDeleteRow(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete this user."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="pmm-page">
      <div className="pmm-header">
        <div>
          <h1>Users &amp; Access</h1>
          <p className="uap-header-stats">
            <strong>{users.length}</strong> users &middot; <strong>{activeCount}</strong> active
          </p>
        </div>
        <div className="pmm-header-actions">
          <div className="pmm-search-wrap">
            <span className="pmm-search-icon"><SearchIcon /></span>
            <input
              type="search"
              className="pmm-search"
              placeholder="Search name, email, role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="pmm-search"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as UserStatus | "all")}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <PlusIcon /> Add User
          </button>
        </div>
      </div>

      {!isLoading && error && (
        <div className="pmm-form-error"><AlertIcon /><span>{error}</span></div>
      )}

      {isLoading && (
        <div className="pmm-panel">
          <div style={{ padding: 16 }}>
            <SkeletonRows rows={6} cols={4} />
          </div>
        </div>
      )}

      {!isLoading && !error && users.length === 0 && (
        <EmptyState
          icon="check"
          title="No users yet"
          description="Access requests and directly-added users will show up here."
        />
      )}

      {!isLoading && !error && users.length > 0 && (
        <div className="pmm-panel">
          <div className="pmm-table-wrap">
            <table className="pmm-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Reviewed</th>
                  <th className="pmm-actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => {
                  const isSelf = row.id === me?.id;
                  const busy = actioningId === row.id;
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="uap-user">
                          <span className="uap-avatar" style={{ ["--uap-hue" as string]: avatarHue(row.email) }} aria-hidden>
                            {initialsOf(row.name, row.email)}
                          </span>
                          <div>
                            <span className="uap-user-name">{row.name || "—"}</span>
                            <span className="uap-user-email">{row.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`uap-badge uap-role-${row.role}`}>
                          {ROLE_LABELS[row.role]}
                        </span>
                      </td>
                      <td>
                        <span className={`uap-badge uap-status-${row.status}`}>
                          {STATUS_LABELS[row.status]}
                        </span>
                        {isSelf && <span className="uap-self-tag">(you)</span>}
                      </td>
                      <td className="mono">{fmtDate(row.created_at)}</td>
                      <td>
                        {row.status === "pending" ? (
                          <span className="uap-review uap-review-waiting">Awaiting review</span>
                        ) : row.review_kind && row.reviewed_by_name ? (
                          <span className={`uap-review uap-review-${row.review_kind}`}>
                            <span className="uap-review-who">
                              {row.review_kind === "added" ? "Added by" : row.review_kind === "rejected" ? "Rejected by" : "Approved by"}{" "}
                              <strong>{row.reviewed_by_name}</strong>
                            </span>
                            {row.reviewed_at && <span className="uap-review-when">{fmtDate(row.reviewed_at)}</span>}
                          </span>
                        ) : (
                          <span className="uap-review uap-review-none">—</span>
                        )}
                      </td>
                      <td>
                        <div className="pmm-row-actions">
                          {row.status === "pending" ? (
                            <>
                              <button
                                className="pmm-btn pmm-btn-primary"
                                disabled={busy}
                                onClick={() => handleReview(row.id, "active")}
                              >
                                {busy ? <Spinner size="sm" inline /> : <CheckIcon />} Approve
                              </button>
                              <button
                                className="pmm-btn pmm-btn-danger"
                                disabled={busy}
                                onClick={() => handleReview(row.id, "rejected")}
                              >
                                <XIcon /> Reject
                              </button>
                            </>
                          ) : (
                            <button
                              className="pmm-btn"
                              disabled={busy || isSelf}
                              title={isSelf ? "You can't deactivate your own account." : undefined}
                              onClick={() => handleToggleActive(row)}
                            >
                              {busy ? (
                                <Spinner size="sm" inline />
                              ) : row.status === "active" ? (
                                <PauseIcon />
                              ) : (
                                <PlayIcon />
                              )}
                              {row.status === "active" ? "Deactivate" : "Reactivate"}
                            </button>
                          )}
                          <button className="pmm-btn" onClick={() => setEditRow(row)}>
                            <EditIcon /> Edit
                          </button>
                          <button
                            className="pmm-btn pmm-btn-danger pmm-btn-icon"
                            disabled={isSelf}
                            title={isSelf ? "You can't delete your own account." : "Delete user"}
                            aria-label="Delete user"
                            onClick={() => setDeleteRow(row)}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="pmm-empty-cell">
                      <EmptyState
                        compact
                        icon="search"
                        title="No users match your filters"
                        description="Try a different search term or status filter."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            itemLabel="users"
          />
        </div>
      )}

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={(u) => {
            setUsers((prev) => [u, ...prev]);
            setCreating(false);
          }}
        />
      )}

      {editRow && (
        <EditUserModal
          row={editRow}
          isSelf={editRow.id === me?.id}
          onClose={() => setEditRow(null)}
          onSaved={(u) => {
            applyUpdate(u);
            setEditRow(null);
          }}
        />
      )}

      <ConfirmModal
        open={deleteRow !== null}
        title="Delete this user?"
        description={
          deleteRow ? (
            <>
              <strong>{deleteRow.name || deleteRow.email}</strong> will be permanently removed.
              This can&apos;t be undone.
            </>
          ) : null
        }
        confirmLabel={deleting ? "Deleting…" : "Delete user"}
        tone="danger"
        busy={deleting}
        onConfirm={handleDelete}
        onClose={() => !deleting && setDeleteRow(null)}
      />
    </div>
  );
};

// --- Add User modal ---------------------------------------------------------

const CreateUserModal = ({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (u: PendingUser) => void;
}) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) return setFormError("Name is required.");
    if (!email.trim()) return setFormError("Email is required.");
    if (password.length < 6) return setFormError("Password must be at least 6 characters.");

    setSaving(true);
    setFormError("");
    try {
      const created = await createUser({ name: name.trim(), email: email.trim(), password, role });
      onCreated(created);
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't add user."));
      setSaving(false);
    }
  };

  return (
    <div className="pmm-modal-overlay" onClick={onClose}>
      <div className="pmm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="pmm-modal-header">
          <h3>Add user</h3>
          <button className="pmm-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleCreate}>
          {formError && (
            <div className="pmm-form-error"><AlertIcon /><span>{formError}</span></div>
          )}
          <div className="pmm-form-grid">
            <div className="pmm-field">
              <label>Full Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="pmm-field">
              <label>Email *</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="pmm-field">
              <label>Password *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="pmm-field">
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="uap-field-hint">
            Created accounts are active immediately — no approval step needed.
          </p>
          <div className="pmm-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <Spinner size="sm" inline />}
              {saving ? "Adding…" : "Add user"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Edit User modal --------------------------------------------------------

const EditUserModal = ({
  row,
  isSelf,
  onClose,
  onSaved,
}: {
  row: PendingUser;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (u: PendingUser) => void;
}) => {
  const [name, setName] = useState(row.name ?? "");
  const [role, setRole] = useState<UserRole>(row.role);
  const [status, setStatus] = useState<UserStatus>(row.status);
  // Password reset is opt-in: an empty box leaves the password alone, so an
  // ordinary name/role edit can never blank someone out by accident.
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) return setFormError("Name can't be empty.");
    if (password && password.length < 6) {
      return setFormError("Password must be at least 6 characters.");
    }
    if (password && password !== confirmPassword) {
      return setFormError("The two passwords don't match.");
    }

    setSaving(true);
    setFormError("");
    try {
      const updated = await updateUser(row.id, {
        name: name.trim(),
        role,
        // "pending" isn't a settable target status — leave a pending row's
        // status alone unless the admin explicitly approves/rejects it from
        // the table row actions instead.
        status: status === "pending" ? undefined : status,
        password: password || undefined,
      });
      onSaved(updated);
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't save changes."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pmm-modal-overlay" onClick={onClose}>
      <div className="pmm-modal pmm-modal-sm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="pmm-modal-header">
          <h3>Edit {row.name || row.email}</h3>
          <button className="pmm-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSave}>
          {formError && (
            <div className="pmm-form-error"><AlertIcon /><span>{formError}</span></div>
          )}
          <div className="pmm-field" style={{ marginBottom: 14 }}>
            <label>Full Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="pmm-field" style={{ marginBottom: 14 }}>
            <label>Role</label>
            <select
              value={role}
              disabled={isSelf}
              title={isSelf ? "You can't change your own role." : undefined}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          {row.status !== "pending" && (
            <div className="pmm-field">
              <label>Status</label>
              <select
                value={status}
                disabled={isSelf}
                title={isSelf ? "You can't change your own status." : undefined}
                onChange={(e) => setStatus(e.target.value as UserStatus)}
              >
                {(["active", "deactivated", "rejected"] as UserStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Password reset. Hidden for your own row — changing your own
              password goes through Change Password, which verifies the
              current one first. */}
          {!isSelf && (
            <>
              <div className="pmm-field" style={{ marginTop: 14, marginBottom: 14 }}>
                <label>New Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Leave blank to keep the current password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {password && (
                <div className="pmm-field">
                  <label>Confirm New Password</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Re-enter the new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <span className="pmm-field-hint">
                    {row.name || row.email} will be asked to set their own
                    password at the next login.
                  </span>
                </div>
              )}
            </>
          )}
          <div className="pmm-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <Spinner size="sm" inline />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UsersAccessPage;
