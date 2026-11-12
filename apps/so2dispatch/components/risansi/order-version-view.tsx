/**
 * An SO as it stood at one version, read-only: its details, payment terms,
 * every EC with each department's work on it, and the SO-level departments.
 * Server-rendered from a version snapshot (lib/order-versions); nothing here
 * edits anything.
 */
import { Fragment } from "react";
import Link from "next/link";
import { History, Lock } from "lucide-react";
import {
  CHILD_FIELDS,
  ORDER_SECTIONS,
  canonicalSelectValue,
  splitMulti,
  type ChildTable,
  type OrderField,
  type OrderSection,
} from "@/lib/order-schema";
import type { VersionSnapshot, VersionsData } from "@/lib/order-versions";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T|$)/;
function day(v: string): string {
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(d.getTime())) return v;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  return v.length > 10 ? `${date}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}` : date;
}

/** A field's value as the forms show it. */
export function showField(field: OrderField, value: unknown): string {
  if (value === null || value === undefined || str(value) === "") return "";
  if (field.type === "date") return day(str(value).slice(0, 10));
  if (field.type === "number" || field.type === "int") {
    const n = Number(value);
    if (Number.isFinite(n)) return new Intl.NumberFormat("en-IN").format(n);
  }
  if (field.type === "select") {
    const v = canonicalSelectValue(field, str(value));
    return field.options?.find((o) => o.value === v)?.label ?? v;
  }
  if (field.type === "multiselect") return splitMulti(value).map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(", ");
  return str(value);
}

/** A column with no field to say how to show it. */
function showRaw(key: string, value: unknown, users: Record<string, string>): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  const s = String(value).trim();
  if (/(_by|_user_id|assignee_id)$/.test(key) && users[s]) return users[s];
  if (DATE_RE.test(s)) return day(s);
  return s;
}

const HIDDEN = new Set(["id", "order_id", "item_id", "seq", "updated_at"]);
const humanize = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Rows of a table with no fields defined: every column that holds something. */
function RawTable({ rows, users }: { rows: Row[]; users: Record<string, string> }) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(
    (k) => !HIDDEN.has(k) && !/_id$/.test(k.replace(/(_by|_user_id|assignee_id)$/, "")) && rows.some((r) => showRaw(k, r[k], users) !== "")
  );
  return <Grid cols={cols.map((c) => ({ key: c, label: humanize(c) }))} rows={rows.map((r) => Object.fromEntries(cols.map((c) => [c, showRaw(c, r[c], users)])))} />;
}

/** Rows of a list with its fields: the columns that hold something. */
function FieldTable({ fields, rows }: { fields: OrderField[]; rows: Row[] }) {
  const cols = fields.filter((f) => rows.some((r) => showField(f, r[f.column]) !== ""));
  return (
    <Grid
      cols={cols.map((f) => ({ key: f.column, label: f.label }))}
      rows={rows.map((r) => Object.fromEntries(cols.map((f) => [f.column, showField(f, r[f.column])])))}
    />
  );
}

function Grid({ cols, rows }: { cols: { key: string; label: string }[]; rows: Record<string, string>[] }) {
  if (rows.length === 0 || cols.length === 0) return <p className="text-xs text-muted">Nothing recorded.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-card-border">
      <table className="w-full text-xs">
        <thead className="bg-background/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
          <tr>
            {cols.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-2.5 py-1.5">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key} className="max-w-[22rem] whitespace-pre-wrap break-words px-2.5 py-1.5 align-top text-foreground">
                  {r[c.key] || <span className="text-muted">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A one-row section's filled fields, label and value, under their groups. */
function Fields({ fields, row }: { fields: OrderField[]; row: Row | null | undefined }) {
  const filled = fields.filter((f) => row && showField(f, row[f.column]) !== "");
  if (filled.length === 0) return <p className="text-xs text-muted">Nothing recorded.</p>;
  const groups: { name: string; fields: OrderField[] }[] = [];
  for (const f of filled) {
    const name = f.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.fields.push(f);
    else groups.push({ name, fields: [f] });
  }
  return (
    <div className="space-y-3">
      {groups.map((g, i) => (
        <div key={i}>
          {g.name && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.name}</p>}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {g.fields.map((f) => (
              <div key={f.column} className="min-w-0">
                <dt className="text-[11px] text-muted">{f.label}</dt>
                <dd className="whitespace-pre-wrap break-words text-sm text-foreground">{showField(f, row![f.column])}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-card-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-semibold text-foreground">{title}</p>
      {children}
    </div>
  );
}

const section = (table: string) => ORDER_SECTIONS.find((s) => s.table === table) as OrderSection;

/** The EC tables with no section of their own, shown under the EC as they are. */
const EC_EXTRA: [string, string][] = [
  ["order_part_drawings", "Part drawings"],
  ["order_drawing_documents", "Drawing documents"],
  ["order_qc_doc_links", "Quality document links"],
  ["order_qc_documents", "Quality documents"],
  ["order_qc_requirement_documents", "Quality requirement documents"],
  ["order_part_shortages", "Part shortages"],
  ["order_lot_assembly", "Lot assembly entries"],
  ["order_ready_lot_history", "Readiness lot history"],
  ["order_packing_plan_history", "Packing plan history"],
];

/** …and the SO's. */
const SO_EXTRA: [string, string][] = [
  ["order_wooden_boxes", "Wooden boxes"],
  ["order_target_revisions", "Target date history"],
  ["order_assembly_plans", "Assembly plans"],
  ["order_dept_completions", "Department sign-offs"],
  ["order_drawing_readiness_history", "Drawing readiness history"],
  ["order_followups", "Follow-ups"],
  ["order_om_status_history", "Order Making clear / hold history"],
  ["order_pendency", "Pendency"],
  ["order_invoice_slips", "Invoice ↔ packing slip links"],
  ["order_picture_links", "Picture links"],
  ["order_boi_expected_history", "BOI expected date history"],
];

const bySeq = (a: Row, b: Row) => (Number(a.seq ?? 0) - Number(b.seq ?? 0)) || str(a.created_at).localeCompare(str(b.created_at));

export function OrderVersionView({ snap }: { snap: VersionSnapshot }) {
  const t = (name: string) => [...(snap.tables[name] ?? [])].sort(bySeq);
  const users = (snap as VersionSnapshot & { users?: Record<string, string> }).users ?? {};
  const one = (name: string, key: "order_id" | "item_id", id: string) => t(name).find((r) => str(r[key]) === id) ?? null;
  const ofEc = (name: string, id: string) => t(name).filter((r) => str(r.item_id) === id);
  const orderId = str(snap.order.id);
  const core = section("orders");

  return (
    <div className="space-y-4">
      <Block title="Order details">
        <Fields fields={core.fields} row={snap.order} />
        <Sub title="Payment terms">
          <FieldTable fields={CHILD_FIELDS.order_payment_terms} rows={t("order_payment_terms")} />
        </Sub>
      </Block>

      {snap.items.map((it) => {
        const id = str(it.id);
        const ec = section("order_items");
        return (
          <Block key={id} title={`EC ${str(it.ec_no) || "—"}${str(it.item_type) ? ` · ${str(it.item_type)}` : ""}`}>
            <Fields fields={ec.fields} row={it} />
            {ORDER_SECTIONS.filter((s) => s.scope === "item" && s.table !== "order_items").map((s) => {
              const row = one(s.table, "item_id", id);
              const child = s.childTable && s.childTable !== "order_packing_slips" ? ofEc(s.childTable, id) : [];
              if (!row && child.length === 0) return null;
              return (
                <Sub key={s.key} title={s.title}>
                  {row && <Fields fields={s.fields} row={row} />}
                  {child.length > 0 && (
                    <div className="mt-2">
                      <FieldTable fields={CHILD_FIELDS[s.childTable as ChildTable]} rows={child} />
                    </div>
                  )}
                </Sub>
              );
            })}
            {EC_EXTRA.map(([name, title]) => {
              const rows = ofEc(name, id);
              return rows.length ? (
                <Sub key={name} title={title}>
                  <RawTable rows={rows} users={users} />
                </Sub>
              ) : null;
            })}
          </Block>
        );
      })}

      {(["order_billing", "order_accounts", "order_dispatch"] as const).map((table) => {
        const s = section(table);
        const row = one(table, "order_id", orderId);
        const child = s.childTable ? t(s.childTable) : [];
        return (
          <Block key={table} title={s.title}>
            {row || child.length === 0 ? <Fields fields={s.fields} row={row} /> : null}
            {s.childTable && child.length > 0 && (
              <div className="mt-2">
                <FieldTable fields={CHILD_FIELDS[s.childTable]} rows={child} />
              </div>
            )}
          </Block>
        );
      })}

      <Block title="Packing slips">
        {(["tentative", "actual"] as const).map((kind) => {
          const rows = t("order_packing_slips").filter((r) => str(r.kind) === kind);
          return rows.length ? (
            <Sub key={kind} title={kind === "actual" ? "Actual (Assembly & Packing)" : "Tentative (Planning)"}>
              <FieldTable fields={[{ column: "lot_nos", label: "Lots", type: "text" }, ...CHILD_FIELDS.order_packing_slips]} rows={rows} />
            </Sub>
          ) : (
            <Fragment key={kind} />
          );
        })}
        {t("order_packing_slips").length === 0 && <p className="text-xs text-muted">Nothing recorded.</p>}
      </Block>

      <Block title="Other records">
        {SO_EXTRA.map(([name, title]) => {
          const rows = t(name);
          return rows.length ? (
            <details key={name} className="mt-2 first:mt-0">
              <summary className="cursor-pointer text-xs font-semibold text-foreground">
                {title} <span className="font-normal text-muted">({rows.length})</span>
              </summary>
              <div className="mt-1.5">
                <RawTable rows={rows} users={users} />
              </div>
            </details>
          ) : null;
        })}
      </Block>
    </div>
  );
}

const when = (v: string) =>
  new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/**
 * An SO's versions: one to pick (a link on the page, a button in the pop-up),
 * the picked one read-only — or the current one — and what changed in it.
 */
export function VersionsBody({
  data,
  hrefFor,
  onPick,
}: {
  data: VersionsData;
  hrefFor?: (n: number) => string;
  onPick?: (n: number) => void;
}) {
  const { currentNo, picked, frozen, versions, snap, before } = data;
  const changes = before ? diffVersions(before, snap) : [];
  const madeBy = picked > 0 ? versions.find((x) => x.version_no === picked - 1) : undefined;
  const pill = (n: number) =>
    `inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-semibold transition-colors ${
      n === picked ? "border-primary bg-primary text-primary-foreground" : "border-input-border text-foreground hover:bg-background"
    }`;
  return (
    <>
      <nav aria-label="Versions" className="mb-4 flex flex-wrap gap-1.5">
        {Array.from({ length: currentNo + 1 }, (_, i) => i).map((n) => {
          const inner = (
            <>
              {n < currentNo && <Lock className="h-3 w-3" />}v{n}
              {n === currentNo && <span className="font-normal opacity-80">· current</span>}
            </>
          );
          return hrefFor ? (
            <Link key={n} href={hrefFor(n)} aria-current={n === picked ? "page" : undefined} className={pill(n)}>
              {inner}
            </Link>
          ) : (
            <button key={n} type="button" onClick={() => onPick?.(n)} aria-pressed={n === picked} className={pill(n)}>
              {inner}
            </button>
          );
        })}
      </nav>

      {frozen ? (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="font-semibold">Version {picked} · read-only</p>
          <p className="mt-0.5 text-xs">
            Saved {when(frozen.created_at)}
            {frozen.created_by_name ? ` by ${frozen.created_by_name}` : ""}, when v{picked + 1} was made — {frozen.reason}
          </p>
          <p className="mt-0.5 text-xs opacity-80">The SO and every department&apos;s work as they stood then. The departments work on v{currentNo}.</p>
        </div>
      ) : (
        <div role="status" className="mb-4 rounded-xl border border-card-border bg-surface px-4 py-3 text-sm text-foreground">
          <p className="font-semibold">Version {currentNo} · current</p>
          <p className="mt-0.5 text-xs text-muted">
            {currentNo === 0 ? "No earlier version yet." : "Where the departments work. The earlier versions are kept read-only."}
          </p>
        </div>
      )}

      {picked > 0 && (
        <section className="mb-4 rounded-xl border border-card-border bg-surface p-4">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <History className="h-4 w-4 text-primary" />
            What changed in v{picked}
          </h2>
          {madeBy && (
            <p className="mb-3 text-xs text-muted">
              Made {when(madeBy.created_at)}
              {madeBy.created_by_name ? ` by ${madeBy.created_by_name}` : ""} — {madeBy.reason}
            </p>
          )}
          {changes.length === 0 ? (
            <p className="text-xs text-muted">Nothing changed from v{picked - 1} yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-card-border">
              <table className="w-full text-xs">
                <thead className="bg-background/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-2.5 py-1.5">Where</th>
                    <th className="px-2.5 py-1.5">What</th>
                    <th className="px-2.5 py-1.5">v{picked - 1}</th>
                    <th className="px-2.5 py-1.5">v{picked}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {changes.map((c, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">{c.where}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-foreground">{c.field}</td>
                      <td className="whitespace-pre-wrap px-2.5 py-1.5 text-muted line-through decoration-rose-400/60">{c.from}</td>
                      <td className="whitespace-pre-wrap px-2.5 py-1.5 font-medium text-foreground">{c.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <OrderVersionView snap={snap} />
    </>
  );
}

// ---- What changed between two versions -------------------------------------

export type VersionChange = { where: string; field: string; from: string; to: string };

const SKIP_DIFF = new Set(["updated_at", "version_no", "created_at"]);

/** The SO's details, ECs, payment terms and department rows that differ from one version to the next. */
export function diffVersions(a: VersionSnapshot, b: VersionSnapshot): VersionChange[] {
  const out: VersionChange[] = [];
  const fieldDiff = (where: string, fields: OrderField[], x: Row | null, y: Row | null) => {
    for (const f of fields) {
      const from = x ? showField(f, x[f.column]) : "";
      const to = y ? showField(f, y[f.column]) : "";
      if (from !== to) out.push({ where, field: f.label, from: from || "—", to: to || "—" });
    }
  };
  fieldDiff("SO", section("orders").fields, a.order, b.order);

  const ecFields = section("order_items").fields;
  const ecName = (r: Row) => `EC ${str(r.ec_no) || "—"}`;
  const aItems = new Map(a.items.map((r) => [str(r.id), r]));
  const bItems = new Map(b.items.map((r) => [str(r.id), r]));
  for (const [id, r] of bItems) {
    if (!aItems.has(id)) out.push({ where: ecName(r), field: "EC", from: "—", to: "Added" });
    else fieldDiff(ecName(r), ecFields, aItems.get(id)!, r);
  }
  for (const [id, r] of aItems) if (!bItems.has(id)) out.push({ where: ecName(r), field: "EC", from: "Present", to: "Removed" });

  const termLine = (r: Row) => CHILD_FIELDS.order_payment_terms.map((f) => showField(f, r[f.column])).filter(Boolean).join(" · ");
  const terms = (s: VersionSnapshot) => [...(s.tables.order_payment_terms ?? [])].sort(bySeq).map(termLine).join("\n");
  if (terms(a) !== terms(b)) out.push({ where: "SO", field: "Payment terms", from: terms(a) || "—", to: terms(b) || "—" });

  // Each department's rows: how many were added, removed or changed.
  const TITLES: Record<string, string> = Object.fromEntries([
    ...ORDER_SECTIONS.map((s) => [s.table, s.title]),
    ["order_drawing_revisions", "Drawing (GAD revisions)"],
    ["order_boi_items", "Purchase (BOI items)"],
    ["order_ready_lots", "Planning (readiness lots)"],
    ["order_billing_docs", "Proforma Invoice (PIs)"],
    ["order_invoices", "Dispatch (invoices)"],
    ["order_packing_slips", "Packing slips"],
    ...EC_EXTRA,
    ...SO_EXTRA,
  ]);
  const clean = (r: Row) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !SKIP_DIFF.has(k)).sort()));
  for (const name of Object.keys(TITLES)) {
    if (name === "orders" || name === "order_items" || name === "order_payment_terms") continue;
    const ra = new Map((a.tables[name] ?? []).map((r) => [str(r.id), clean(r)]));
    const rb = new Map((b.tables[name] ?? []).map((r) => [str(r.id), clean(r)]));
    let added = 0, removed = 0, changed = 0;
    for (const [id, v] of rb) {
      if (!ra.has(id)) added++;
      else if (ra.get(id) !== v) changed++;
    }
    for (const id of ra.keys()) if (!rb.has(id)) removed++;
    const parts = [added && `${added} added`, changed && `${changed} changed`, removed && `${removed} removed`].filter(Boolean);
    if (parts.length) out.push({ where: "Department work", field: TITLES[name], from: "", to: parts.join(", ") });
  }
  return out;
}
