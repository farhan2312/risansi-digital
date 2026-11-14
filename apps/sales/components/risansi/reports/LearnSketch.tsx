// The diagrams on the training page.
//
// Every one is hand-drawn SVG with invented figures. The reasons, in order of
// how much they matter:
//
//   1. A screenshot of this app shows real client names and real revenue, and
//      anything under public/ is served with no session attached. A training
//      screenshot there would be readable by anybody who guessed the URL.
//   2. A screenshot is wrong the day a button moves and nobody notices. These
//      are schematic on purpose: they show the shape of the screen, not its
//      pixels, so they stay true through a restyle.
//   3. They read correctly in dark mode, because they are drawn in the same
//      tokens as the rest of the app rather than baked at one theme.
//
// Each case here answers a `SketchKind` in lib/custom-analytics/learn.ts, and
// the build fails if a topic names a kind this file does not draw.

import type { SketchKind } from '@/lib/custom-analytics/learn';

const PAPER = 'var(--bg-paper)';
const BG = 'var(--bg)';
const LINE = 'var(--line)';
const STRONG = 'var(--line-strong)';
const FG = 'var(--fg)';
const DIM = 'var(--fg-3)';
const FAINT = 'var(--fg-4)';
const FILL = 'var(--accent-fill)';
const SOFT = 'var(--accent-soft)';
const ACCENT = 'var(--accent)';

const MONO = 'var(--font-mono, ui-monospace), monospace';

/** A card-shaped rectangle. */
function Box(p: { x: number; y: number; w: number; h: number; fill?: string; stroke?: string; dash?: boolean; r?: number }) {
  return (
    <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r ?? 3}
      fill={p.fill ?? PAPER} stroke={p.stroke ?? LINE}
      strokeDasharray={p.dash ? '3 2' : undefined} strokeWidth={1} />
  );
}

function T(p: { x: number; y: number; children: string; size?: number; fill?: string; weight?: number; anchor?: 'start' | 'middle' | 'end'; mono?: boolean }) {
  return (
    <text x={p.x} y={p.y} fontSize={p.size ?? 6.5} fill={p.fill ?? DIM}
      fontWeight={p.weight ?? 400} textAnchor={p.anchor ?? 'start'}
      fontFamily={p.mono ? MONO : 'inherit'}>{p.children}</text>
  );
}

/** A filled pill, the way a chip reads in the real panels. */
function Chip(p: { x: number; y: number; w: number; label: string; tone?: 'accent' | 'plain' }) {
  const accent = p.tone !== 'plain';
  return (
    <>
      <rect x={p.x} y={p.y} width={p.w} height={11} rx={5.5}
        fill={accent ? SOFT : BG} stroke={accent ? ACCENT : LINE} />
      <T x={p.x + 5} y={p.y + 7.6} size={6} fill={accent ? FG : DIM}>{p.label}</T>
    </>
  );
}

function Bars(p: { x: number; y: number; h: number; heights: number[]; gap?: number; w?: number; hot?: number }) {
  const w = p.w ?? 7, gap = p.gap ?? 4;
  return (
    <>
      {p.heights.map((frac, i) => {
        const bh = Math.max(2, p.h * frac);
        return (
          <rect key={i} x={p.x + i * (w + gap)} y={p.y + p.h - bh} width={w} height={bh}
            fill={p.hot === i ? FILL : 'var(--accent-mid, var(--accent))'}
            opacity={p.hot === undefined || p.hot === i ? 1 : 0.35} rx={1} />
        );
      })}
    </>
  );
}

/** The grey strip at the top of a card, standing in for its title. */
function Head(p: { x: number; y: number; w: number }) {
  return <rect x={p.x} y={p.y} width={p.w} height={3} rx={1.5} fill={LINE} />;
}

export function LearnSketch({ kind }: { kind: SketchKind }) {
  const svg = (children: React.ReactNode, h = 150) => (
    <svg viewBox={`0 0 320 ${h}`} role="img" aria-hidden
      style={{ width: '100%', maxWidth: 430, height: 'auto', display: 'block' }}>
      {children}
    </svg>
  );

  switch (kind) {
    // A report page: pages across the top, one filter bar, cards on a grid.
    case 'page':
      return svg(<>
        <Box x={2} y={2} w={316} h={146} fill={BG} stroke={STRONG} r={5} />
        <T x={10} y={14} size={7} fill={FG} weight={600}>Sales overview</T>
        <rect x={10} y={19} width={34} height={2} fill={ACCENT} />
        <T x={48} y={21} size={6}>Orders</T>
        <T x={80} y={21} size={6}>Against plan</T>
        <line x1={10} y1={23} x2={310} y2={23} stroke={LINE} />
        <Chip x={10} y={28} w={40} label="This FY" />
        <Chip x={54} y={28} w={44} label="All states" tone="plain" />
        <Chip x={102} y={28} w={40} label="All reps" tone="plain" />
        {/* two KPIs, a chart, a table */}
        <Box x={10} y={46} w={66} h={30} />
        <T x={16} y={57} size={5.5} fill={FAINT}>REVENUE</T>
        <T x={16} y={68} size={9} fill={FG} weight={600} mono>₹20.4 Cr</T>
        <Box x={80} y={46} w={66} h={30} />
        <T x={86} y={57} size={5.5} fill={FAINT}>ORDERS</T>
        <T x={86} y={68} size={9} fill={FG} weight={600} mono>₹24.1 Cr</T>
        <Box x={150} y={46} w={160} h={54} />
        <Head x={156} y={52} w={48} />
        <Bars x={158} y={62} h={32} heights={[0.5, 0.7, 0.45, 0.9, 0.62, 0.8, 0.55, 0.95, 0.7, 0.6]} />
        <Box x={10} y={80} w={136} h={60} />
        <Head x={16} y={86} w={40} />
        {[0, 1, 2, 3, 4].map(i => (
          <line key={i} x1={16} y1={97 + i * 8} x2={140} y2={97 + i * 8} stroke={LINE} />
        ))}
        <Box x={150} y={104} w={160} h={36} />
        <Head x={156} y={110} w={34} />
        <Bars x={158} y={118} h={16} heights={[0.9, 0.7, 0.55, 0.4, 0.3]} w={24} gap={6} />
      </>);

    // Clicking one bar holds every other card on the page to that category.
    case 'crossfilter':
      return svg(<>
        <Chip x={10} y={6} w={92} label="State: Maharashtra  ✕" />
        <T x={108} y={14} size={6} fill={FAINT}>held on every card until you let it go</T>
        <Box x={10} y={24} w={150} h={112} />
        <Head x={16} y={30} w={44} />
        <Bars x={18} y={44} h={80} heights={[1, 0.62, 0.48, 0.35, 0.28, 0.2]} w={18} gap={6} hot={0} />
        <T x={20} y={132} size={5.5} fill={FG}>MH</T>
        <T x={44} y={132} size={5.5} fill={FAINT}>GJ</T>
        <T x={68} y={132} size={5.5} fill={FAINT}>TN</T>
        <T x={92} y={132} size={5.5} fill={FAINT}>KA</T>
        <T x={116} y={132} size={5.5} fill={FAINT}>UP</T>
        <path d="M164 70 L 186 70" stroke={ACCENT} strokeWidth={1.2} markerEnd="url(#lsArrow)" />
        <defs>
          <marker id="lsArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={ACCENT} />
          </marker>
        </defs>
        <Box x={190} y={24} w={120} h={52} />
        <T x={196} y={36} size={5.5} fill={FAINT}>REVENUE</T>
        <T x={196} y={50} size={7} fill={FAINT} mono>was ₹20.4 Cr</T>
        <T x={196} y={66} size={11} fill={FG} weight={600} mono>₹6.28 Cr</T>
        <Box x={190} y={84} w={120} h={52} />
        <Head x={196} y={90} w={34} />
        <Bars x={198} y={100} h={28} heights={[0.8, 0.6, 0.45, 0.3]} w={20} gap={7} />
      </>);

    // Four templates, each with what it answers.
    case 'templates':
      return svg(<>
        {[['Sales overview', 'Where is revenue coming from?', '2 pages, 9 cards'],
          ['Pipeline health', 'What is our win rate?', '2 pages, 8 cards'],
          ['Service and complaints', 'Which models come back?', '2 pages, 8 cards'],
          ['Coverage and visits', 'Who is getting out?', '2 pages, 7 cards']].map(([title, ans, size], i) => {
          const x = 8 + (i % 2) * 156, y = 8 + Math.floor(i / 2) * 68;
          return (
            <g key={title}>
              <Box x={x} y={y} w={148} h={60} />
              <T x={x + 8} y={y + 16} size={7} fill={FG} weight={600}>{title}</T>
              <T x={x + 8} y={y + 28} size={6}>{ans}</T>
              <rect x={x + 8} y={y + 38} width={46} height={12} rx={3} fill={FILL} />
              <T x={x + 31} y={y + 46.5} size={6} fill="#fff" anchor="middle">Use this</T>
              <T x={x + 62} y={y + 46.5} size={5.5} fill={FAINT}>{size}</T>
            </g>
          );
        })}
      </>);

    // The card on the left, the panel that edits it on the right.
    case 'wells':
      return svg(<>
        <Box x={6} y={16} w={104} h={116} stroke={ACCENT} />
        <T x={14} y={30} size={5.5} fill={FAINT}>REVENUE BY MONTH</T>
        <Bars x={14} y={40} h={68} heights={[0.5, 0.72, 0.58, 0.88, 0.66, 0.8, 0.6, 0.95]} w={8} gap={4} />
        <T x={14} y={122} size={5.5} fill={FAINT}>selected</T>
        <path d="M112 74 L 122 74" stroke={ACCENT} strokeWidth={1.2} markerEnd="url(#lsArrowW)" />
        <defs>
          <marker id="lsArrowW" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={ACCENT} />
          </marker>
        </defs>
        <Box x={126} y={2} w={188} h={146} fill={BG} stroke={STRONG} r={5} />
        <T x={136} y={16} size={7} fill={FG} weight={600}>Column chart</T>
        <T x={136} y={26} size={6} fill={FAINT}>Revenue</T>
        {[['Axis', 'What runs along the bottom', 'Revenue month · Month'],
          ['Legend', 'Splits each bar into parts', 'Direct / OEM'],
          ['Numbers', 'What is being measured', 'Revenue ₹ · Sum']].map(([well, hint, chip], i) => {
          const y = 36 + i * 36;
          return (
            <g key={well}>
              <T x={136} y={y + 6} size={6.5} fill={FG} weight={600}>{well}</T>
              <T x={170} y={y + 6} size={5.5} fill={FAINT}>{hint}</T>
              <Box x={136} y={y + 10} w={168} h={18} fill={PAPER} dash />
              <Chip x={141} y={y + 14} w={140} label={chip} />
              <T x={294} y={y + 23} size={7} fill={FAINT} anchor="middle">✕</T>
            </g>
          );
        })}
      </>);

    // Twelve columns, no overlap, and a dashed outline where a card will land.
    case 'grid':
      return svg(<>
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1={10 + i * 25} y1={6} x2={10 + i * 25} y2={140} stroke={LINE} strokeDasharray="2 3" />
        ))}
        <T x={10} y={146} size={5.5} fill={FAINT}>twelve columns, 44px rows</T>
        <Box x={10} y={10} w={148} h={44} />
        <T x={18} y={22} size={5.5} fill={FAINT}>REVENUE BY MONTH</T>
        <Bars x={18} y={28} h={20} heights={[0.5, 0.75, 0.6, 0.9, 0.7]} />
        <T x={146} y={20} size={8} fill={DIM} anchor="end">⠿</T>
        <Box x={10} y={60} w={98} h={54} />
        <T x={18} y={72} size={5.5} fill={FAINT}>TOP CLIENTS</T>
        <Bars x={18} y={78} h={28} heights={[0.9, 0.65, 0.5, 0.3]} w={16} gap={6} />
        <path d="M104 110 l6 0 0 -6" stroke={STRONG} strokeWidth={1.4} fill="none" />
        {/* The dashed outline is where the card will snap to; the card itself
            is drawn offset and half-transparent, as it is mid-drag. Drawing
            them on top of each other hid both, and hid the label with them. */}
        <Box x={170} y={16} w={120} h={50} dash fill={SOFT} stroke={ACCENT} />
        <g opacity={0.92}>
          <Box x={192} y={44} w={120} h={50} />
          <T x={200} y={56} size={5.5} fill={FAINT}>BY STATE</T>
          <Bars x={200} y={62} h={24} heights={[0.8, 0.6, 0.45, 0.33, 0.25]} w={14} gap={6} />
          <T x={304} y={54} size={8} fill={ACCENT} anchor="end">⠿</T>
        </g>
        <T x={230} y={110} size={6.5} fill={ACCENT} anchor="middle">where it will land</T>
        <path d="M212 104 L 206 70" stroke={ACCENT} strokeWidth={0.8} strokeDasharray="2 2" fill="none" />
      </>);

    // One card, two tables, lined up on what they share.
    case 'combine':
      return svg(<>
        <Box x={8} y={16} w={86} h={48} />
        <T x={14} y={28} size={6.5} fill={FG} weight={600}>Revenue</T>
        <T x={14} y={40} size={6}>Client</T>
        <T x={14} y={52} size={6}>Revenue ₹</T>
        <Box x={8} y={84} w={86} h={48} />
        <T x={14} y={96} size={6.5} fill={FG} weight={600}>Orders (uploaded)</T>
        <T x={14} y={108} size={6}>Client</T>
        <T x={14} y={120} size={6}>Order value ₹</T>
        <path d="M94 40 C 120 40, 120 74, 140 74" stroke={ACCENT} strokeWidth={1.2} fill="none" />
        <path d="M94 108 C 120 108, 120 74, 140 74" stroke={ACCENT} strokeWidth={1.2} fill="none" />
        <T x={117} y={70} size={6} fill={ACCENT} anchor="middle">client</T>
        <Box x={146} y={10} w={166} h={128} />
        <T x={154} y={24} size={5.5} fill={FAINT}>REVENUE AGAINST ORDERS</T>
        <line x1={154} y1={30} x2={304} y2={30} stroke={STRONG} />
        {[['ACME PUMPS', '4.21', '5.02'],
          ['BHARAT STEEL', '3.08', '2.74'],
          ['COASTAL POWER', '2.55', '3.11'],
          ['DELTA CHEM', '1.92', '1.40']].map(([c, a, b], i) => (
          <g key={c}>
            <T x={154} y={42 + i * 14} size={6} fill={FG}>{c}</T>
            <T x={262} y={42 + i * 14} size={6} fill={FG} anchor="end" mono>{a}</T>
            <T x={304} y={42 + i * 14} size={6} fill={FG} anchor="end" mono>{b}</T>
          </g>
        ))}
        <T x={154} y={124} size={5.5} fill={FAINT}>Two tables, matched on client</T>
      </>);

    // The page filter bar, and the two jobs it does.
    case 'filters':
      return svg(<>
        <Box x={6} y={10} w={308} h={34} fill={BG} stroke={STRONG} />
        <T x={14} y={24} size={5.5} fill={FAINT}>DATE RANGE</T>
        <Box x={14} y={28} w={56} h={11} />
        <T x={18} y={35.6} size={6} fill={FG}>This FY ▾</T>
        {[['STATE', 'All'], ['INDUSTRY', 'All'], ['REP', 'All'], ['TIER', 'All']].map(([l, v], i) => (
          <g key={l}>
            <T x={82 + i * 58} y={24} size={5.5} fill={FAINT}>{l}</T>
            <Box x={82 + i * 58} y={28} w={50} h={11} />
            <T x={86 + i * 58} y={35.6} size={6} fill={FG}>{`${v} ▾`}</T>
          </g>
        ))}
        <T x={6} y={62} size={6.5} fill={FG} weight={600}>In the builder</T>
        <T x={6} y={74} size={6}>This is the position every reader opens on. Saved with the report.</T>
        <T x={6} y={96} size={6.5} fill={FG} weight={600}>In the viewer</T>
        <T x={6} y={108} size={6}>The same bar is yours alone. Change anything; the report does not move.</T>
        <T x={6} y={130} size={6} fill={ACCENT}>Pick a range by name, not two dates, and the report still means this next April.</T>
      </>);

    // What the export looks like when it opens.
    case 'sheet':
      return svg(<>
        <Box x={6} y={6} w={308} h={138} fill={PAPER} stroke={STRONG} />
        <T x={14} y={18} size={6} fill={FAINT}>Sales overview — Revenue by client</T>
        <T x={14} y={28} size={6} fill={FAINT}>This FY · all states · State: Maharashtra</T>
        <rect x={14} y={34} width={292} height={13} fill="#BDD7EE" />
        {['CLIENT', 'STATE', 'REVENUE ₹', 'ORDERS ₹'].map((h, i) => (
          <T key={h} x={20 + i * 73} y={43} size={6} fill="#002060" weight={600}>{h}</T>
        ))}
        {[['ACME PUMPS', 'Maharashtra', '4,21,08,400', '5,02,11,000'],
          ['BHARAT STEEL', 'Maharashtra', '3,08,77,250', '2,74,90,500'],
          ['COASTAL POWER', 'Maharashtra', '2,55,14,000', '3,11,02,800'],
          ['DELTA CHEM', 'Maharashtra', '1,92,60,100', '1,40,33,000'],
          ['EASTERN MILLS', 'Maharashtra', '1,44,02,900', '1,76,21,400']].map((r, i) => (
          <g key={r[0]}>
            {r.map((c, j) => (
              <T key={j} x={j >= 2 ? 86 + j * 73 : 20 + j * 73} y={59 + i * 13} size={6}
                 fill={FG} anchor={j >= 2 ? 'end' : 'start'} mono={j >= 2}>{c}</T>
            ))}
            <line x1={14} y1={63 + i * 13} x2={306} y2={63 + i * 13} stroke={LINE} />
          </g>
        ))}
        <T x={14} y={138} size={5.5} fill={FAINT}>508 rows — every client, not the 15 the chart had room for</T>
      </>);

    // The four things a card says when it cannot draw.
    case 'refusal':
      return svg(<>
        {[['This card is not finished', '· Add a number.', 'Half built. Nothing wrong.'],
          ['Nothing in this range', '', 'It ran. The answer was nothing.'],
          ['This visual took too long', 'add a filter or pick fewer categories', 'Too broad for the data behind it.'],
          ['Order in hand can’t be split', 'tables only line up on client, state…', 'A real refusal, and why.']].map(([a, b, c], i) => {
          const x = 8 + (i % 2) * 156, y = 8 + Math.floor(i / 2) * 68;
          return (
            <g key={a}>
              <Box x={x} y={y} w={148} h={60} />
              <T x={x + 74} y={y + 24} size={6.5} fill={DIM} anchor="middle">{a}</T>
              {b && <T x={x + 74} y={y + 34} size={5.5} fill={FAINT} anchor="middle">{b}</T>}
              <line x1={x + 8} y1={y + 42} x2={x + 140} y2={y + 42} stroke={LINE} />
              <T x={x + 74} y={y + 53} size={6} fill={FG} anchor="middle">{c}</T>
            </g>
          );
        })}
      </>);
  }
}
