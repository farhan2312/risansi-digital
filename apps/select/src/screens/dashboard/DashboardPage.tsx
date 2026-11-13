"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, ChartBar, CircleAlert, CircleCheck, Clock, FileText, FolderOpen, ShieldCheck, Tag as TagIcon } from "lucide-react";

import { DonutChart, fmtDay, fmtNum, TrendChart, type TrendSeries } from "../../components/charts/charts";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import { canApprove } from "../../lib/approval";
import { isRepRole, isViewOnlyRole, worksOnAnyEnquiry } from "../../lib/roles";
import RepPicker from "../../components/projects/RepPicker";
import { getDashboard, type DashboardData, type DashboardEnquiry, type DashboardTag } from "../../services/dashboardService";
import { SELECTED_PROJECT_KEY } from "../projects/ProjectsPage";
import DateRangeFilter, { useDateRange } from "../../components/ui/DateRangeFilter";
import DashboardListModal, { type DashboardListTarget } from "./DashboardListModal";
import ClientMix from "./ClientMix";
import EnquiryFilterBar from "../../components/projects/EnquiryFilterBar";
import type { EnquiryFilters } from "../../lib/enquiry-filters";
import { usePageTitle } from "../../components/layout/PageTitle";
// shadcn/ui (user, 2026-11-13: the Dashboard in the new look, branch select-shadcn).
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Card } from "@/components/shadcn/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";
import { cn } from "@/lib/utils";

type Tone = "warning" | "info" | "success" | "neutral" | "danger" | "primary";

/** A status as the badges and the charts mean it (index.css --chart-* are validated for
 *  colour-blind separation). */
const STATUS: Record<string, { tone: Tone; color: string }> = {
  Pending: { tone: "warning", color: "var(--chart-pending)" },
  "In Progress": { tone: "info", color: "var(--chart-progress)" },
  Completed: { tone: "success", color: "var(--chart-done)" },
  "Sent to client": { tone: "primary", color: "var(--chart-sent)" },
  "Not Quoted": { tone: "neutral", color: "var(--chart-none)" },
  Regret: { tone: "danger", color: "var(--chart-regret)" },
};
const statusOf = (s: string) => STATUS[s] ?? { tone: "neutral" as Tone, color: "var(--chart-none)" };
const STATUS_COLORS = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.color]));

const StatusPill = ({ status }: { status: string }) => (
  <Badge tone={statusOf(status).tone} dot>
    {status}
  </Badge>
);

/** The icon chip on a KPI card, in its status' tone. */
const TONE_CHIP: Record<Tone, string> = {
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  neutral: "bg-muted text-muted-foreground",
  danger: "bg-destructive/10 text-destructive",
  primary: "bg-primary/8 text-primary",
};

const greetingFor = (d: Date) => (d.getHours() < 12 ? "Good morning" : d.getHours() < 17 ? "Good afternoon" : "Good evening");

/** A dashboard section: a card with a title row (and an action on its right). */
function Section({
  title,
  subtitle,
  icon,
  action,
  children,
  className,
  bodyClassName = "p-4",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("min-w-0 overflow-hidden", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-foreground">{title}</h3>
            {subtitle && <p className="truncate text-[11.5px] text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}

/** A KPI card with its figures side by side - enquiries and tags, or a spare's enquiries alone. */
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
  tone: Tone;
}) {
  return (
    <Card className="flex h-full flex-col gap-2 p-3 transition-shadow hover:shadow-[0_6px_18px_rgba(15,23,42,0.07)]">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5 ${TONE_CHIP[tone]}`}>{icon}</span>
      </div>
      <div className={`grid flex-1 gap-1.5 ${cells.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {cells.map((c) => {
          const inner = (
            <>
              <span className="flex items-center justify-between gap-1 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
                {c.label}
                {c.onClick && <ArrowRight className="size-3 opacity-0 transition group-hover/cell:opacity-100" />}
              </span>
              <span className="mt-1 block font-mono text-[24px] leading-none font-semibold text-foreground tabular-nums">{c.value}</span>
              {c.sub && <span className="mt-1.5 block text-[11.5px] leading-snug text-muted-foreground">{c.sub}</span>}
            </>
          );
          return c.onClick ? (
            <button
              key={c.label}
              type="button"
              onClick={c.onClick}
              title={c.hint}
              className="group/cell min-w-0 rounded-md bg-muted/60 px-2.5 py-2 text-left transition-colors outline-none hover:bg-primary/8 focus-visible:ring-[3px] focus-visible:ring-ring/30"
            >
              {inner}
            </button>
          ) : (
            <div key={c.label} className="min-w-0 rounded-md px-2.5 py-2">
              {inner}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Horizontal bars for small ranked lists. */
function Bars({ items, color }: { items: { key: string; label: ReactNode; value: number; hint?: ReactNode }[]; color: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="py-6 text-center text-[12.5px] text-muted-foreground">Nothing yet</p>;
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.key} title={`${typeof it.label === "string" ? `${it.label}: ` : ""}${fmtNum(it.value)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate text-foreground">{it.label}</span>
            <span className="shrink-0 font-mono font-semibold text-foreground tabular-nums">
              {fmtNum(it.value)}
              {it.hint && <span className="ml-1.5 font-sans text-[11px] font-normal text-muted-foreground">{it.hint}</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
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
      className="group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted"
      title="Open this tag in Pump Selection"
    >
      <span className="size-2 shrink-0 rounded-full" style={{ background: statusOf(tag.status).color }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[12.5px] font-medium text-foreground">{tag.name}</span>
          <span className="text-[11px] text-muted-foreground">{tag.status}</span>
          {tag.reportGeneratedAt && (
            <Badge tone="success">
              <CircleCheck /> Report
            </Badge>
          )}
          {tag.approvals.awaiting > 0 && <Badge tone="warning">{tag.approvals.awaiting} awaiting approval</Badge>}
          {tag.approvals.rejected > 0 && <Badge tone="danger">{tag.approvals.rejected} rejected</Badge>}
        </div>
        {details.length > 0 && <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{details.join(" · ")}</div>}
      </div>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

/** Enquiry no., status, client and who / when. */
function EnquiryHeading({ enquiry }: { enquiry: DashboardEnquiry }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] font-semibold text-primary">{enquiry.code}</span>
        <StatusPill status={enquiry.status} />
      </div>
      <div className="mt-0.5 truncate text-[13px] font-medium text-foreground">{enquiry.client}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
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
  );
}

/** A spare: no tags, the row opens its quotation. */
function SpareItem({ enquiry }: { enquiry: DashboardEnquiry }) {
  return (
    <li>
      <Link href={`/commercial?projectId=${enquiry.id}`} className="group flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50" title="Open its quotation">
        <EnquiryHeading enquiry={enquiry} />
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
      </Link>
    </li>
  );
}

function EnquiryItem({ enquiry, onOpenTag }: { enquiry: DashboardEnquiry; onOpenTag: (tag?: DashboardTag) => void }) {
  const done = enquiry.tags.filter((t) => t.status === "Completed").length;
  const total = enquiry.tags.length;
  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <EnquiryHeading enquiry={enquiry} />
        <div className="w-[140px] shrink-0 text-right">
          <div className="text-[11.5px] text-muted-foreground">
            <b className="font-mono font-semibold text-foreground">{done}</b> / {total} tag{total === 1 ? "" : "s"} done
          </div>
          {/* One segment per tag, a 2px gap between them. */}
          <div className="mt-1 flex h-1.5 gap-[2px] overflow-hidden rounded-full">
            {enquiry.tags.map((t) => (
              <span key={t.id} className="h-full flex-1" style={{ background: statusOf(t.status).color }} title={`${t.name}: ${t.status}`} />
            ))}
            {total === 0 && <span className="h-full flex-1 bg-muted" />}
          </div>
        </div>
      </div>

      {total > 0 ? (
        <div className="mt-2 rounded-md border border-border bg-muted/30 py-1">
          {enquiry.tags.map((t) => (
            <TagRow key={t.id} tag={t} onOpen={() => onOpenTag(t)} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-muted-foreground">No tags yet.</p>
      )}
    </li>
  );
}

const DashboardPage = () => {
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const dates = useDateRange("all");
  const [scope, setScope] = useState<"all" | "mine">("all");
  // A worker opens on "Assigned to me" (they can still switch to All). Nothing
  // loads until the role is known - otherwise an "All" request fired first
  // could land after the "mine" one and show every enquiry under "Assigned to me".
  const scopeDefaulted = useRef(false);
  const [scopeReady, setScopeReady] = useState(false);
  useEffect(() => {
    if (scopeDefaulted.current) return;
    if (!user && userLoading) return;
    scopeDefaulted.current = true;
    if (user && !worksOnAnyEnquiry(user.role) && !isViewOnlyRole(user.role)) {
      setScope("mine");
    }
    setScopeReady(true);
  }, [user, userLoading]);
  // Client / reps / zone / market / industry / status (same as the Enquiries page),
  // always on Pump or Spare: a spare has no tags or approvals, so its figures differ.
  const [filters, setFilters] = useState<EnquiryFilters>({ orderType: ["Pump"] });
  const isSpare = filters.orderType?.[0] === "Spare";
  // Rep / Rep Manager: only their own enquiries (scoped by the API); a manager
  // can narrow to one rep.
  const isRep = isRepRole(user?.role);
  const [rep, setRep] = useState("");
  const [trendView, setTrendView] = useState<"created" | "completed">("created");

  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = dates.window;

  useEffect(() => {
    if (!scopeReady) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getDashboard({ ...query, mine: scope === "mine", filters, rep })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError("Couldn't load dashboard data."))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, scope, filters, scopeReady, rep]);

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
  const scopeText = scope === "mine" ? "Assigned to me" : "All enquiries";
  const openList = (kind: DashboardListTarget["kind"], status: DashboardListTarget["status"], title: string) => () =>
    setListTarget({ kind, status, title });

  const k = data?.kpis;
  const pct = (n: number) => (k && k.tags ? Math.round((n / k.tags) * 100) : 0);
  // Enquiries by rolled-up status (same rule as the Enquiries list).
  const enqCount = (label: string) => data?.enquiryStatus.find((s) => s.label === label)?.count ?? 0;
  const enqPct = (n: number) => (k && k.enquiries ? Math.round((n / k.enquiries) * 100) : 0);
  const now = new Date();
  const firstName = user?.name?.split(" ")[0] || "there";
  // The greeting and the date are the top bar's heading (user, 2026-11-13).
  usePageTitle(
    `${greetingFor(now)}, ${firstName}`,
    `${now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${isSpare ? "spare enquiries" : "enquiries, tags and approvals"} at a glance`,
  );
  const windowLabel = dates.label;

  const enquirySeries: TrendSeries = { key: "enq", label: "Enquiries", color: "var(--chart-1)", values: (data?.trend ?? []).map((d) => d.enquiries) };
  const trendSeries: TrendSeries[] = isSpare
    ? [enquirySeries]
    : trendView === "created"
      ? [
          enquirySeries,
          { key: "tags", label: "Tags", color: "var(--chart-2)", values: (data?.trend ?? []).map((d) => d.tags) },
        ]
      : [{ key: "done", label: "Tags completed (by creation day)", color: "var(--chart-1)", values: (data?.trend ?? []).map((d) => d.completed) }];


  return (
    <div className="min-h-full bg-background">
    <div className="w-full px-4 pt-4 pb-10 sm:px-6 min-[1101px]:px-0">
      {/* Filters (the greeting is the top bar's heading) */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {isRep ? (
            <RepPicker value={rep} onChange={setRep} />
          ) : (
            <Tabs value={scope} onValueChange={(v) => setScope(v === "mine" ? "mine" : "all")}>
              <TabsList aria-label="Which enquiries">
                <TabsTrigger value="all">All enquiries</TabsTrigger>
                <TabsTrigger value="mine">Assigned to me</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <DateRangeFilter state={dates} />
          <Button asChild className="ml-auto">
            <Link href="/projects">
              <FolderOpen /> Go to Enquiries
            </Link>
          </Button>
        </div>
        <div className="border-t border-border bg-muted/40 px-4 py-2.5">
          <EnquiryFilterBar value={filters} onChange={setFilters} orderTypeRequired />
        </div>
      </Card>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/8 px-4 py-2.5 text-[13px] font-medium text-destructive" role="alert">
          <CircleAlert className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Everything below the filters dims while a reload (scope / period) is loading. */}
      <div className={`transition-opacity ${isLoading && data ? "pointer-events-none opacity-60" : ""}`} aria-busy={isLoading || undefined}>
      {/* KPIs */}
      <div className={`mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 ${isSpare ? "lg:grid-cols-3 2xl:grid-cols-7" : "lg:grid-cols-3 xl:grid-cols-5"}`}>
        {isLoading && !data
          ? Array.from({ length: isSpare ? 7 : 5 }, (_, i) => <div key={i} className="h-[124px] animate-pulse rounded-lg border border-border bg-card" />)
          : k &&
            (isSpare ? (
              <>
                <KpiSplit
                  label="Enquiries"
                  cells={[{ label: "Enquiries", value: fmtNum(k.enquiries), sub: windowLabel, onClick: openList("enquiries", "all", "All spare enquiries"), hint: "Show the enquiries" }]}
                  icon={<FolderOpen />}
                  tone="primary"
                />
                {(
                  [
                    ["Pending", "Pending", <Clock key="i" />],
                    ["In progress", "In Progress", <Activity key="i" />],
                    ["Completed", "Completed", <CircleCheck key="i" />],
                    ["Sent to client", "Sent to client", <FileText key="i" />],
                    ["Not quoted", "Not Quoted", <CircleAlert key="i" />],
                    ["Regret", "Regret", <CircleAlert key="i" />],
                  ] as const
                ).map(([label, status, icon]) => (
                  <KpiSplit
                    key={status}
                    label={label}
                    cells={[
                      {
                        label: "Enquiries",
                        value: fmtNum(enqCount(status)),
                        sub: `${enqPct(enqCount(status))}% of all`,
                        onClick: openList("enquiries", status, `${label} spare enquiries`),
                        hint: `Show the ${label.toLowerCase()} enquiries`,
                      },
                    ]}
                    icon={icon}
                    tone={statusOf(status).tone}
                  />
                ))}
              </>
            ) : (
              <>
                <KpiSplit
                  label="Enquiries & Tags"
                  cells={[
                    { label: "Enquiries", value: fmtNum(k.enquiries), sub: windowLabel, onClick: openList("enquiries", "all", "All enquiries"), hint: "Show the enquiries" },
                    { label: "Tags", value: fmtNum(k.tags), sub: windowLabel, onClick: openList("tags", "all", "All tags"), hint: "Show the tags" },
                  ]}
                  icon={<FolderOpen />}
                  tone="primary"
                />
                {(
                  [
                    ["Pending", "Pending", k.pending, <Clock key="i" />],
                    ["In progress", "In Progress", k.inProgress, <Activity key="i" />],
                    ["Completed", "Completed", k.completed, <CircleCheck key="i" />],
                  ] as const
                ).map(([label, status, tagCount, icon]) => (
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
                    tone={statusOf(status).tone}
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
                  icon={<ShieldCheck />}
                  tone="warning"
                />
              </>
            ))}
      </div>

      {data && (
        <>
          {/* Trend + tag status */}
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Section
              className="xl:col-span-2"
              icon={<Activity />}
              title={isSpare ? "Enquiries over time" : "Enquiries & tags over time"}
              subtitle={`Per IST day · ${windowLabel}`}
              action={
                isSpare ? undefined : (
                  <Tabs value={trendView} onValueChange={(v) => setTrendView(v === "completed" ? "completed" : "created")}>
                    <TabsList aria-label="Trend">
                      <TabsTrigger value="created">Created</TabsTrigger>
                      <TabsTrigger value="completed">Completed</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )
              }
            >
              {data.trend.length === 0 ? (
                <p className="py-16 text-center text-[12.5px] text-muted-foreground">Nothing created in this period</p>
              ) : (
                <>
                  <TrendChart days={data.trend.map((d) => d.day)} series={trendSeries} mode="bars" />
                  {/* Always named: the Completed view's one series isn't what the title says. */}
                  {trendSeries.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-11">
                      {trendSeries.map((s) => (
                        <span key={s.key} className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                          <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
                          {s.label}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Section>

            {isSpare ? (
              <Section icon={<Activity />} title="Status" subtitle="Where every spare enquiry stands">
                <DonutChart items={data.enquiryStatus} centerLabel="enquiries" colors={STATUS_COLORS} />
              </Section>
            ) : (
              <Section icon={<TagIcon />} title="Tag status" subtitle="Where every tag stands">
                <DonutChart
                  items={[
                    { label: "Pending", count: data.kpis.pending },
                    { label: "In Progress", count: data.kpis.inProgress },
                    { label: "Completed", count: data.kpis.completed },
                  ].filter((i) => i.count > 0)}
                  centerLabel="tags"
                  colors={STATUS_COLORS}
                />
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
                  {data.enquiryStatus.map((s) => (
                    <div key={s.label} className="rounded-md bg-muted/60 px-2 py-2">
                      <div className="font-mono text-[17px] font-semibold text-foreground tabular-nums">{s.count}</div>
                      <div className="text-[10.5px] text-muted-foreground">{s.label} enquiries</div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>

          {/* Client mix: market, zone, primary reps, rep x zone */}
          <ClientMix mix={data.mix} />

          {/* Recent enquiries with tags + side panels */}
          <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <Section
              className="xl:col-span-2"
              icon={<FolderOpen />}
              title="Recent enquiries"
              subtitle={isSpare ? "Newest first · click one to open its quotation" : "Newest first, with every tag · click a tag to open it"}
              bodyClassName=""
              action={
                <Button variant="link" size="sm" asChild className="px-0">
                  <Link href="/projects">
                    View all <ArrowRight />
                  </Link>
                </Button>
              }
            >
              {data.recent.length === 0 ? (
                <p className="py-12 text-center text-[12.5px] text-muted-foreground">
                  {scope === "mine" ? "No enquiries assigned to you in this period." : "No enquiries in this period."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.recent.map((e) => (isSpare ? <SpareItem key={e.id} enquiry={e} /> : <EnquiryItem key={e.id} enquiry={e} onOpenTag={(t) => openTag(e, t)} />))}
                </ul>
              )}
            </Section>

            <div className="space-y-4">
              {!isSpare && (
                <Section icon={<ShieldCheck />} title="Approvals" subtitle="Steps sent to selection heads">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {(
                      [
                        { label: "Awaiting", value: data.approvals.awaiting, tone: "warning" },
                        { label: "Approved", value: data.approvals.approved, tone: "success" },
                        { label: "Rejected", value: data.approvals.rejected, tone: "danger" },
                      ] as const
                    ).map((a) => (
                      <div key={a.label} className={`rounded-md px-2 py-3 ${TONE_CHIP[a.tone]}`}>
                        <div className="font-mono text-[20px] leading-none font-semibold tabular-nums">{a.value}</div>
                        <div className="mt-1 text-[11px] font-medium">{a.label}</div>
                      </div>
                    ))}
                  </div>
                  {canApprove(user?.role) && data.approvals.awaiting > 0 && (
                    <Button variant="outline" size="sm" asChild className="mt-3 w-full">
                      <Link href="/approvals">
                        Review {data.approvals.awaiting} waiting <ArrowRight />
                      </Link>
                    </Button>
                  )}
                </Section>
              )}

              <Section icon={<ChartBar />} title="Enquiries by industry">
                <Bars color="var(--chart-1)" items={data.industries.map((i) => ({ key: i.label, label: i.label, value: i.count }))} />
              </Section>
            </div>
          </div>

          {data.trend.length > 0 && (
            <p className="mt-3 text-right text-[11px] text-muted-foreground">
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
          filters={filters}
          rep={rep}
          scopeLabel={`${scopeText} · ${windowLabel}`}
          onClose={() => setListTarget(null)}
          hideTagCount={isSpare}
          onOpenEnquiry={(r) => (isSpare ? router.push(`/commercial?projectId=${r.id}`) : openTag(r))}
          onOpenTag={(r) => openTag({ ...r.enquiry, status: r.enquiry.status ?? "" }, r)}
        />
      )}
    </div>
    </div>
  );
};

export default DashboardPage;
