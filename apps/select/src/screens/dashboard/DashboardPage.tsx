"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DonutChart, fmtDay, fmtNum, TrendChart, type TrendSeries } from "../../components/charts/charts";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import { canApprove } from "../../lib/approval";
import { getDashboard, type DashboardData, type DashboardEnquiry, type DashboardTag } from "../../services/dashboardService";
import { Avatar, Card, Icons, Segmented } from "../admin/audit/auditUi";
import { SELECTED_PROJECT_KEY } from "../projects/ProjectsPage";
import DateRangeFilter, { useDateRange } from "../../components/ui/DateRangeFilter";
import DashboardListModal, { type DashboardListTarget } from "./DashboardListModal";

const STATUS_STYLE: Record<string, { pill: string; dot: string; color: string }> = {
  Pending: { pill: "bg-[var(--warn-soft)] text-warn", dot: "bg-warn", color: "var(--warn)" },
  "In Progress": { pill: "bg-accent-soft text-accent", dot: "bg-[var(--brand-blue)]", color: "var(--brand-blue)" },
  Completed: { pill: "bg-[var(--pos-soft)] text-pos", dot: "bg-pos", color: "var(--pos)" },
};
const statusStyle = (s: string) => STATUS_STYLE[s] ?? { pill: "bg-sunk text-fg-2", dot: "bg-fg-4", color: "var(--fg-4)" };

const StatusPill = ({ status }: { status: string }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${statusStyle(status).pill}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${statusStyle(status).dot}`} />
    {status}
  </span>
);

const greetingFor = (d: Date) => (d.getHours() < 12 ? "Good morning" : d.getHours() < 17 ? "Good afternoon" : "Good evening");

/** A KPI card with two figures side by side - enquiries and tags. */
function KpiSplit({
  label,
  cells,
  icon,
  tone,
}: {
  label: string;
  /** A half with onClick is its own button, opening that half's list. */
  cells: { label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void; hint?: string }[];
  icon: ReactNode;
  tone: string;
}) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-xl border border-line bg-paper p-3 transition hover:border-line-strong hover:shadow-[0_6px_18px_rgba(10,22,40,0.07)]">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="text-[11px] font-semibold tracking-[0.08em] text-fg-3 uppercase">{label}</div>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-1.5">
        {cells.map((c) => {
          const inner = (
            <>
              <span className="flex items-center justify-between gap-1 text-[10.5px] font-semibold tracking-[0.06em] text-fg-4 uppercase">
                {c.label}
                {c.onClick && (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3 w-3 opacity-0 transition group-hover/cell:opacity-100">
                    <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="mt-1 block font-mono text-[24px] leading-none font-bold text-fg tabular-nums">{c.value}</span>
              {c.sub && <span className="mt-1.5 block text-[11.5px] leading-snug text-fg-3">{c.sub}</span>}
            </>
          );
          return c.onClick ? (
            <button
              key={c.label}
              type="button"
              onClick={c.onClick}
              title={c.hint}
              className="group/cell min-w-0 rounded-lg bg-[color-mix(in_srgb,var(--bg-elev)_60%,transparent)] px-2.5 py-2 text-left transition hover:bg-accent-soft hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              {inner}
            </button>
          ) : (
            <div key={c.label} className="min-w-0 rounded-lg px-2.5 py-2">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Horizontal bars for small ranked lists. */
function Bars({ items, color }: { items: { key: string; label: ReactNode; value: number; hint?: ReactNode }[]; color: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="py-6 text-center text-[12.5px] text-fg-3">Nothing yet</p>;
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate text-fg-2">{it.label}</span>
            <span className="shrink-0 font-mono font-semibold text-fg tabular-nums">
              {fmtNum(it.value)}
              {it.hint && <span className="ml-1.5 font-sans text-[11px] font-normal text-fg-3">{it.hint}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(it.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function TagRow({ tag, onOpen }: { tag: DashboardTag; onOpen: () => void }) {
  const details = [tag.model && `Model ${tag.model}`, tag.duty, tag.liquid, tag.pumpType].filter(Boolean) as string[];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-elev"
      title="Open this tag in Pump Selection"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${statusStyle(tag.status).dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[12.5px] font-semibold text-fg">{tag.name}</span>
          <span className="text-[11px] text-fg-3">{tag.status}</span>
          {tag.reportGeneratedAt && (
            <span className="rounded-full bg-[var(--pos-soft)] px-1.5 py-px text-[10px] font-semibold text-pos">Report ✓</span>
          )}
          {tag.approvals.awaiting > 0 && (
            <span className="rounded-full bg-[var(--warn-soft)] px-1.5 py-px text-[10px] font-semibold text-warn">
              {tag.approvals.awaiting} awaiting approval
            </span>
          )}
          {tag.approvals.rejected > 0 && (
            <span className="rounded-full bg-[var(--neg-soft)] px-1.5 py-px text-[10px] font-semibold text-neg">
              {tag.approvals.rejected} rejected
            </span>
          )}
        </div>
        {details.length > 0 && <div className="mt-0.5 truncate text-[11.5px] text-fg-3">{details.join(" · ")}</div>}
      </div>
      <span className="shrink-0 text-fg-4 transition group-hover:translate-x-0.5 group-hover:text-accent">→</span>
    </button>
  );
}

function EnquiryItem({ enquiry, onOpenTag }: { enquiry: DashboardEnquiry; onOpenTag: (tag?: DashboardTag) => void }) {
  const done = enquiry.tags.filter((t) => t.status === "Completed").length;
  const total = enquiry.tags.length;
  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-bold text-title">{enquiry.code}</span>
            <StatusPill status={enquiry.status} />
          </div>
          <div className="mt-0.5 truncate text-[13px] font-medium text-fg">{enquiry.client}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-fg-3">
            {enquiry.industry && <span>{enquiry.industry}</span>}
            {enquiry.createdByName && (
              <>
                <span>·</span>
                <span>{enquiry.createdByName}</span>
              </>
            )}
            {enquiry.createdAt && (
              <>
                <span>·</span>
                <span>{new Date(enquiry.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
              </>
            )}
          </div>
        </div>
        <div className="w-[140px] shrink-0 text-right">
          <div className="text-[11.5px] text-fg-3">
            <b className="font-mono text-fg">{done}</b> / {total} tag{total === 1 ? "" : "s"} done
          </div>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-sunk">
            {enquiry.tags.map((t) => (
              <span key={t.id} className="h-full" style={{ width: `${100 / Math.max(1, total)}%`, background: statusStyle(t.status).color }} />
            ))}
          </div>
        </div>
      </div>

      {total > 0 ? (
        <div className="mt-2 rounded-lg border border-line bg-[color-mix(in_srgb,var(--bg-elev)_40%,transparent)] py-1">
          {enquiry.tags.map((t) => (
            <TagRow key={t.id} tag={t} onOpen={() => onOpenTag(t)} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-fg-3">No tags yet.</p>
      )}
    </li>
  );
}

const DashboardPage = () => {
  const router = useRouter();
  const { user } = useCurrentUser();
  const dates = useDateRange("all");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [trendView, setTrendView] = useState<"created" | "completed">("created");

  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = dates.window;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getDashboard({ ...query, mine: scope === "mine" })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError("Couldn't load dashboard data."))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, scope]);

  const openTag = (
    enquiry: Pick<DashboardEnquiry, "id" | "code" | "client" | "customer" | "status">,
    tag?: Pick<DashboardTag, "id" | "name">,
  ) => {
    sessionStorage.setItem(
      SELECTED_PROJECT_KEY,
      JSON.stringify({
        id: enquiry.id,
        code: enquiry.code,
        name: enquiry.client,
        customer: enquiry.customer,
        status: enquiry.status,
        tagId: tag?.id,
        tagName: tag?.name,
      }),
    );
    router.push("/pump-selection");
  };

  // The KPI list open in the modal (null = closed).
  const [listTarget, setListTarget] = useState<DashboardListTarget | null>(null);
  const scopeText = scope === "mine" ? "Created by me" : "All enquiries";
  const openList = (kind: DashboardListTarget["kind"], status: DashboardListTarget["status"], title: string) => () =>
    setListTarget({ kind, status, title });

  const k = data?.kpis;
  const pct = (n: number) => (k && k.tags ? Math.round((n / k.tags) * 100) : 0);
  // Enquiries by rolled-up status (same rule as the Enquiries list).
  const enqCount = (label: string) => data?.enquiryStatus.find((s) => s.label === label)?.count ?? 0;
  const enqPct = (n: number) => (k && k.enquiries ? Math.round((n / k.enquiries) * 100) : 0);
  const now = new Date();
  const firstName = user?.name?.split(" ")[0] || "there";
  const windowLabel = dates.label;

  const trendSeries: TrendSeries[] =
    trendView === "created"
      ? [
          { key: "enq", label: "Enquiries", color: "var(--brand-blue)", values: (data?.trend ?? []).map((d) => d.enquiries) },
          { key: "tags", label: "Tags", color: "var(--brand-cyan)", values: (data?.trend ?? []).map((d) => d.tags) },
        ]
      : [{ key: "done", label: "Tags completed (by creation day)", color: "var(--pos)", values: (data?.trend ?? []).map((d) => d.completed) }];

  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-5 pb-10 sm:px-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-paper">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(900px 220px at 0% 0%, color-mix(in srgb, var(--brand-blue) 13%, transparent), transparent 70%), radial-gradient(600px 220px at 100% 0%, color-mix(in srgb, var(--brand-cyan) 12%, transparent), transparent 70%)",
          }}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div>
            <h1 className="text-[23px] leading-tight font-bold text-fg">
              {greetingFor(now)}, {firstName}
            </h1>
            <p className="mt-1 text-[13px] text-fg-3">
              {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · enquiries, tags and
              approvals at a glance
            </p>
          </div>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(10,61,143,0.15)] transition hover:-translate-y-px hover:shadow-[0_6px_16px_color-mix(in_srgb,var(--brand-blue)_30%,transparent)]"
          >
            {Icons.folder} Go to Enquiries
          </Link>
        </div>

        {/* Filters */}
        <div className="relative flex flex-wrap items-center gap-2.5 border-t border-line px-5 py-3">
          <Segmented
            value={scope}
            onChange={setScope}
            loading={isLoading}
            options={[
              { key: "all", label: "All enquiries" },
              { key: "mine", label: "Created by me" },
            ]}
          />
          <DateRangeFilter state={dates} />
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg bg-[var(--neg-soft)] px-4 py-3 text-[13px] font-medium text-neg">{error}</div>}

      {/* Everything below the filters dims while a reload (scope / period) is loading. */}
      <div className={`transition-opacity ${isLoading && data ? "pointer-events-none opacity-60" : ""}`} aria-busy={isLoading || undefined}>
      {/* KPIs */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {isLoading && !data
          ? Array.from({ length: 5 }, (_, i) => <div key={i} className="h-[124px] animate-pulse rounded-xl border border-line bg-paper" />)
          : k && (
              <>
                <KpiSplit
                  label="Enquiries & Tags"
                  cells={[
                    { label: "Enquiries", value: fmtNum(k.enquiries), sub: windowLabel, onClick: openList("enquiries", "all", "All enquiries"), hint: "Show the enquiries" },
                    { label: "Tags", value: fmtNum(k.tags), sub: windowLabel, onClick: openList("tags", "all", "All tags"), hint: "Show the tags" },
                  ]}
                  icon={Icons.folder}
                  tone="bg-accent-soft text-accent"
                />
                {(
                  [
                    ["Pending", "Pending", k.pending, Icons.clock, "bg-[var(--warn-soft)] text-warn"],
                    ["In progress", "In Progress", k.inProgress, Icons.activity, "bg-accent-soft text-accent"],
                    ["Completed", "Completed", k.completed, Icons.check, "bg-[var(--pos-soft)] text-pos"],
                  ] as const
                ).map(([label, status, tagCount, icon, tone]) => (
                  <KpiSplit
                    key={status}
                    label={label}
                    cells={[
                      {
                        label: "Enquiries",
                        value: fmtNum(enqCount(status)),
                        sub: `${enqPct(enqCount(status))}% of all`,
                        onClick: openList("enquiries", status, `${label} enquiries`),
                        hint: `Show the ${label.toLowerCase()} enquiries`,
                      },
                      {
                        label: "Tags",
                        value: fmtNum(tagCount),
                        sub:
                          status === "Completed"
                            ? `${pct(tagCount)}% of all · ${fmtNum(k.reports)} report${k.reports === 1 ? "" : "s"}`
                            : `${pct(tagCount)}% of all`,
                        onClick: openList("tags", status, `${label} tags`),
                        hint: `Show the ${label.toLowerCase()} tags`,
                      },
                    ]}
                    icon={icon}
                    tone={tone}
                  />
                ))}
                <KpiSplit
                  label="Awaiting approval"
                  cells={[
                    {
                      label: "Tags",
                      value: fmtNum(k.awaitingTags),
                      sub: "with steps sent",
                      onClick: openList("tags", "awaiting", "Tags awaiting approval"),
                      hint: "Show the tags awaiting approval",
                    },
                    {
                      label: "Steps",
                      value: fmtNum(k.awaitingApproval),
                      sub: "awaiting a decision",
                      onClick: openList("tags", "awaiting", "Tags awaiting approval"),
                      hint: "Show the tags awaiting approval",
                    },
                  ]}
                  icon={Icons.shield}
                  tone="bg-[color-mix(in_srgb,var(--purple)_14%,transparent)] text-[var(--purple)]"
                />
              </>
            )}
      </div>

      {data && (
        <>
          {/* Trend + tag status */}
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card
              className="xl:col-span-2"
              icon={Icons.activity}
              title="Enquiries & tags over time"
              subtitle={`Per IST day · ${windowLabel}`}
              action={
                <Segmented
                  value={trendView}
                  onChange={setTrendView}
                  options={[
                    { key: "created", label: "Created" },
                    { key: "completed", label: "Completed" },
                  ]}
                />
              }
            >
              {data.trend.length === 0 ? (
                <p className="py-16 text-center text-[12.5px] text-fg-3">Nothing created in this period</p>
              ) : (
                <>
                  <TrendChart days={data.trend.map((d) => d.day)} series={trendSeries} mode="bars" />
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-11">
                    {trendSeries.map((s) => (
                      <span key={s.key} className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-2">
                        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
                        {s.label}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </Card>

            <Card icon={Icons.tag} title="Tag status" subtitle="Where every tag stands">
              <DonutChart
                items={[
                  { label: "Pending", count: data.kpis.pending },
                  { label: "In Progress", count: data.kpis.inProgress },
                  { label: "Completed", count: data.kpis.completed },
                ].filter((i) => i.count > 0)}
                centerLabel="tags"
                colors={{ Pending: "var(--warn)", "In Progress": "var(--brand-blue)", Completed: "var(--pos)" }}
              />
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                {data.enquiryStatus.map((s) => (
                  <div key={s.label} className="rounded-lg bg-elev px-2 py-2">
                    <div className="font-mono text-[17px] font-bold text-fg">{s.count}</div>
                    <div className="text-[10.5px] text-fg-3">{s.label} enquiries</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Recent enquiries with tags + side panels */}
          <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <Card
              className="xl:col-span-2"
              icon={Icons.folder}
              title="Recent enquiries"
              subtitle="Newest first, with every tag · click a tag to open it"
              bodyClassName=""
              action={
                <Link href="/projects" className="text-[12.5px] font-semibold text-accent hover:underline">
                  View all →
                </Link>
              }
            >
              {data.recent.length === 0 ? (
                <p className="py-12 text-center text-[12.5px] text-fg-3">
                  {scope === "mine" ? "You haven't created any enquiries in this period." : "No enquiries in this period."}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.recent.map((e) => (
                    <EnquiryItem key={e.id} enquiry={e} onOpenTag={(t) => openTag(e, t)} />
                  ))}
                </ul>
              )}
            </Card>

            <div className="space-y-4">
              <Card icon={Icons.shield} title="Approvals" subtitle="Steps sent to selection heads">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Awaiting", value: data.approvals.awaiting, cls: "text-warn bg-[var(--warn-soft)]" },
                    { label: "Approved", value: data.approvals.approved, cls: "text-pos bg-[var(--pos-soft)]" },
                    { label: "Rejected", value: data.approvals.rejected, cls: "text-neg bg-[var(--neg-soft)]" },
                  ].map((a) => (
                    <div key={a.label} className={`rounded-lg px-2 py-3 ${a.cls}`}>
                      <div className="font-mono text-[20px] leading-none font-bold">{a.value}</div>
                      <div className="mt-1 text-[11px] font-semibold">{a.label}</div>
                    </div>
                  ))}
                </div>
                {canApprove(user?.role) && data.approvals.awaiting > 0 && (
                  <Link href="/approvals" className="mt-3 block text-center text-[12.5px] font-semibold text-accent hover:underline">
                    Review {data.approvals.awaiting} waiting →
                  </Link>
                )}
              </Card>

              <Card icon={Icons.overview} title="Enquiries by industry">
                <Bars color="var(--brand-blue)" items={data.industries.map((i) => ({ key: i.label, label: i.label, value: i.count }))} />
              </Card>

              {scope === "all" && (
                <Card icon={Icons.users} title="Enquiries by engineer">
                  <Bars
                    color="var(--brand-cyan)"
                    items={data.engineers.map((e) => ({
                      key: e.label,
                      label: (
                        <span className="inline-flex items-center gap-2">
                          <Avatar email={e.label} size={18} />
                          {e.label}
                        </span>
                      ),
                      value: e.enquiries,
                      hint: `${e.tags} tag${e.tags === 1 ? "" : "s"}`,
                    }))}
                  />
                </Card>
              )}
            </div>
          </div>

          {data.trend.length > 0 && (
            <p className="mt-3 text-right text-[11px] text-fg-4">
              Data from {fmtDay(data.trend[0]!.day)} to {fmtDay(data.trend[data.trend.length - 1]!.day)}
            </p>
          )}
        </>
      )}
      </div>

      {listTarget && (
        <DashboardListModal
          target={listTarget}
          period={query}
          mine={scope === "mine"}
          scopeLabel={`${scopeText} · ${windowLabel}`}
          onClose={() => setListTarget(null)}
          onOpenEnquiry={(r) => openTag(r)}
          onOpenTag={(r) => openTag({ ...r.enquiry, status: r.enquiry.status ?? "" }, r)}
        />
      )}
    </div>
  );
};

export default DashboardPage;
