# Risansi Design System — Style Guide

A complete, portable reference for the visual language, theming, layout, and UI/UX
conventions of the Risansi platform. Copy this file into a new project and you can
rebuild the same look and feel without the original repo.

Everything here is real: the exact tokens, the exact component recipes, the exact
pixel values, and the honest list of what does and doesn't adapt to dark mode. Where
the current app made a compromise, this doc says so and gives the clean way to do it.

---

## 0. TL;DR — the five things that define the style

1. **No Tailwind utility classes for visuals.** Components are styled with inline
   React `style={}` objects whose values are **CSS custom properties** (`var(--bg-paper)`,
   `var(--fg)`, …). Tailwind v4 is installed but only as a token bridge for a few shadcn
   primitives; you never write `className="p-4 bg-white"`.
2. **Dark mode flips token *values*, not components.** `next-themes` puts a `.dark`
   class on `<html>`; `:root.dark` redefines the same variables. Components never branch
   on theme — they read `var(--token)` and get the right value automatically.
3. **A tight, cool, corporate palette.** Navy + Risansi blue + cyan, on near-white /
   deep-navy surfaces. Semantic green/red/amber/blue for state. Never pure black or
   pure white.
4. **Numbers are monospace.** Every figure, code, date, currency, and percentage renders
   in **IBM Plex Mono** with `tabular-nums`. Body text is **IBM Plex Sans 13px**.
5. **Dense, quiet, information-first.** Small type, hairline borders, 6px radii, minimal
   shadows, restrained motion. It should feel like Linear/Stripe/Figma-grade internal
   tooling, not a marketing site.

---

## 1. Stack & dependencies

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router) + React 19 |
| Styling | Hand-written inline styles + CSS custom properties. One global CSS file (`globals.css`) + one responsive file (`mobile.css`). |
| Theme switching | [`next-themes`](https://github.com/pacocoursey/next-themes) — class strategy |
| Fonts | `next/font/google`: **IBM Plex Sans**, **IBM Plex Mono**, **Instrument Serif** |
| Component primitives | A small amount of shadcn/ui (Dialog, Input, Button) wired to the same tokens via a bridge. Optional — you can skip shadcn entirely. |
| Charts | **None.** All data-viz is hand-rolled inline-styled divs + raw SVG. No Recharts/Chart.js. |
| Maps (if needed) | `react-simple-maps` for the India geo map, loaded via `next/dynamic({ ssr:false })`. |

Install the essentials:

```bash
npm install next-themes
# fonts come from next/font/google — no package needed
```

---

## 2. Theme setup (do this first)

### 2.1 ThemeProvider

Wrap the app once, in the root layout. Light is the default; system preference is
**disabled** on purpose (the product picks light unless the user toggles dark).

```tsx
// app/layout.tsx
import { ThemeProvider } from '@/components/theme-provider'; // thin wrapper around next-themes
import './globals.css';
import './mobile.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"        // adds `dark` class to <html>
          defaultTheme="light"
          enableSystem={false}     // ignore OS preference; user toggles explicitly
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

```tsx
// components/theme-provider.tsx
'use client';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
export function ThemeProvider(props: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
```

- `suppressHydrationWarning` on `<html>` is required — `next-themes` writes the class
  before React hydrates.
- To read the theme in a component, guard against SSR mismatch:
  `const isDark = mounted && resolvedTheme === 'dark';` (set `mounted` in a `useEffect`).

### 2.2 Fonts

Fonts are loaded with `next/font/google` and exposed as CSS variables. Load them once
in a layout that wraps the authenticated app, and put the generated `.variable` classes
on a wrapper element.

```tsx
import { IBM_Plex_Sans, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';

const sans  = IBM_Plex_Sans({ weight: ['400','500','600'], subsets: ['latin'], variable: '--font-sans',  display: 'swap' });
const mono  = IBM_Plex_Mono({ weight: ['400'],             subsets: ['latin'], variable: '--font-mono',  display: 'swap' });
const serif = Instrument_Serif({ weight: '400',            subsets: ['latin'], variable: '--font-serif', display: 'swap' });

// on the app wrapper:
<div className={`${sans.variable} ${mono.variable} ${serif.variable}`}
     style={{ fontFamily: 'var(--font-sans, "IBM Plex Sans", system-ui, sans-serif)' }}>
```

Weights actually used: Sans **400 / 500 / 600** (no 700 from the webfont — "bold"
labels use 600, or 700 only where a system fallback supplies it), Mono **400**,
Serif **400**. `globals.css` also hardcodes the family names as a fallback so the app
still renders if the font vars aren't present.

`Instrument Serif` is available (`--font-serif`) but used sparingly — it's an accent
display face, not for body or UI.

---

## 3. Design tokens (the foundation) — paste-ready

This is the heart of the system. Drop this into `globals.css`. Light values live on
`:root`; `:root.dark` overrides the **values** only. Every component references these.

```css
/* ── Risansi design tokens ─────────────────────────────────────── */
:root {
  color-scheme: light;

  /* Surfaces (back → front) */
  --bg:        #F4F6FB;  /* page background */
  --bg-paper:  #FFFFFF;  /* cards, panels, topbar, drawers, modals */
  --bg-elev:   #EDF1F7;  /* table header, hover fills, elevated chips */
  --bg-sunk:   #E2E8F3;  /* input wells, progress-bar tracks, sunk areas */
  --bg-ink:    #0A1628;  /* always-navy ink (target lines, chrome) */
  --bg-ink-2:  #132240;

  /* Text (darkest → lightest) */
  --fg:   #0D1B2E;  /* body copy, primary values — use even at small sizes */
  --fg-2: #2D3E55;  /* secondary text, product lines (ok ≥16px, or medium) */
  --fg-3: #6B7F96;  /* labels, captions, meta, muted */
  --fg-4: #A8BAC8;  /* faint — chevrons, disabled hints */

  /* Borders */
  --line:        rgba(10, 22, 40, 0.08);  /* hairline dividers, card borders */
  --line-2:      rgba(10, 22, 40, 0.05);  /* faintest divider */
  --line-strong: rgba(10, 22, 40, 0.16);  /* input borders, control outlines */

  /* Accent — Risansi blue */
  --accent:      #1A5CB8;
  --accent-fg:   #ffffff;
  --accent-soft: rgba(26, 92, 184, 0.10);  /* accent tint background */
  --accent-line: rgba(26, 92, 184, 0.25);  /* focus ring, accent border */

  /* Brand */
  --brand-navy:  #0A1628;  /* the dark navy chrome color */
  --brand-blue:  #1A5CB8;  /* == accent; primary interactive */
  --brand-cyan:  #00A3C4;  /* secondary brand accent */
  --brand-light: #E8F0FB;

  /* Section-title / KPI-accent navy (deeper than accent) */
  --title: #0A3D8F;

  /* Theme-aware component colors (flip in dark) */
  --won-bg:            #F0FDF4;  /* kanban "Won" card background */
  --toggle-sel-bg:     #EBF1FB;  /* selected segmented-toggle pill */
  --toggle-sel-fg:     #0A3D8F;
  --toggle-sel-border: #0A3D8F;

  /* Functional / semantic — solid, soft tint, and strong-on-tint text */
  --pos:        #059669;  --pos-soft:  #D1FAE5;  --pos-strong: #065F46;
  --neg:        #DC2626;  --neg-soft:  #FEE2E2;  --neg-strong: #991B1B;
  --warn:       #D97706;  --warn-soft: #FEF3C7;  /* no warn-strong */
  --info:       #2563EB;  --info-soft: #DBEAFE;  /* no info-strong */
  --purple:     #7C3AED;                          /* solid only */

  /* Radii */
  --radius-sm: 4px;
  --radius:    6px;
  --radius-lg: 10px;
  --radius-xl: 14px;

  /* Fonts */
  --font-sans:  'IBM Plex Sans',    system-ui, sans-serif;
  --font-mono:  'IBM Plex Mono',    ui-monospace, monospace;
  --font-serif: 'Instrument Serif', Georgia, serif;
}

/* ── Dark mode: same variables, new values ─────────────────────── */
:root.dark {
  color-scheme: dark;

  --fg:   #F0F4F8;
  --fg-2: #CBD5E0;
  --fg-3: #8FA3B8;
  --fg-4: #6B7FA3;

  --bg:       #0D1B2E;
  --bg-paper: #132240;
  --bg-elev:  #1A2E4A;
  --bg-sunk:  #0A1628;
  /* --bg-ink / --bg-ink-2 stay the same navy */

  --line:        rgba(255, 255, 255, 0.08);
  --line-2:      rgba(255, 255, 255, 0.05);
  --line-strong: rgba(255, 255, 255, 0.16);

  --brand-blue:  #4A8FE8;   /* lighter blue reads better on navy */
  --accent:      #4A8FE8;
  --accent-soft: rgba(74, 143, 232, 0.15);
  --accent-line: rgba(74, 143, 232, 0.30);
  --title:       #4A8FE8;

  --won-bg:            rgba(5, 150, 105, 0.15);
  --toggle-sel-bg:     var(--brand-blue);
  --toggle-sel-fg:     #ffffff;
  --toggle-sel-border: var(--brand-blue);

  --pos:  #34D399;  --pos-soft:  rgba(52, 211, 153, 0.15);  --pos-strong: #6EE7B7;
  --neg:  #F87171;  --neg-soft:  rgba(248, 113, 113, 0.15); --neg-strong: #FCA5A5;
  --warn: #FBBF24;  --warn-soft: rgba(251, 191, 36, 0.15);
  --info: #60A5FA;  --info-soft: rgba(96, 165, 250, 0.15);
  --purple: #A78BFA;
}

body {
  background: var(--bg);
  color: var(--fg);
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
```

**Why `:root.dark` and not `.dark`:** specificity. `:root.dark` (0,2,0) out-specifies
the plain `:root` (0,1,0) token block that appears later in the file. A bare `.dark`
selector would lose to it on source order. Keep the compound selector.

### 3.1 Token reference table

| Token | Light | Dark | Use for |
|---|---|---|---|
| `--bg` | `#F4F6FB` | `#0D1B2E` | Page background |
| `--bg-paper` | `#FFFFFF` | `#132240` | Cards, panels, topbar, overlays |
| `--bg-elev` | `#EDF1F7` | `#1A2E4A` | Table headers, hover fills |
| `--bg-sunk` | `#E2E8F3` | `#0A1628` | Input wells, progress tracks |
| `--bg-ink` | `#0A1628` | `#0A1628` | Always-navy marks |
| `--fg` | `#0D1B2E` | `#F0F4F8` | Primary text/values |
| `--fg-2` | `#2D3E55` | `#CBD5E0` | Secondary text |
| `--fg-3` | `#6B7F96` | `#8FA3B8` | Labels, captions, meta |
| `--fg-4` | `#A8BAC8` | `#6B7FA3` | Faint / disabled |
| `--line` | `rgba(10,22,40,.08)` | `rgba(255,255,255,.08)` | Hairline borders |
| `--line-strong` | `rgba(10,22,40,.16)` | `rgba(255,255,255,.16)` | Control borders |
| `--accent` / `--brand-blue` | `#1A5CB8` | `#4A8FE8` | Primary interactive |
| `--accent-soft` | `rgba(26,92,184,.10)` | `rgba(74,143,232,.15)` | Accent tint |
| `--title` | `#0A3D8F` | `#4A8FE8` | Panel titles, KPI accent bar |
| `--pos` / `-soft` / `-strong` | `#059669` / `#D1FAE5` / `#065F46` | `#34D399` / `rgba(52,211,153,.15)` / `#6EE7B7` | Positive |
| `--neg` / `-soft` / `-strong` | `#DC2626` / `#FEE2E2` / `#991B1B` | `#F87171` / `rgba(248,113,113,.15)` / `#FCA5A5` | Negative |
| `--warn` / `-soft` | `#D97706` / `#FEF3C7` | `#FBBF24` / `rgba(251,191,36,.15)` | Caution |
| `--info` / `-soft` | `#2563EB` / `#DBEAFE` | `#60A5FA` / `rgba(96,165,250,.15)` | Info |
| `--purple` | `#7C3AED` | `#A78BFA` | 4th category (competitor) |

### 3.2 Sidebar tokens (intentionally *not* theme-flipping)

The left navigation is **dark navy in both light and dark mode** — it's a fixed chrome
surface, like a code editor's activity bar. These tokens (and the literal hex the
sidebar uses) stay constant:

```css
:root {
  --sidebar:            #0A1628;               /* navy, both themes */
  --sidebar-foreground: #B8C9E8;               /* row text */
  --sidebar-accent:     #00B4D8;               /* cyan group labels + active bar */
  --sidebar-border:     rgba(255,255,255,0.08);
}
```

---

## 4. Dark mode mechanics (the full picture)

The whole theme system is three moving parts:

1. **`next-themes`** toggles the `dark` class on `<html>`.
2. **`:root.dark`** redefines every token value.
3. **`color-scheme`** (`light` on `:root`, `dark` on `:root.dark`) makes native
   controls — date pickers, `<select>` popups, scrollbars — render matching chrome.

Two extra rules are needed because inline styles out-specify normal CSS:

```css
/* Native form controls in dark mode. Inline styles on the elements win over
   ordinary rules, so !important is required to retheme them. */
.dark input:not([type="hidden"]),
.dark select,
.dark textarea {
  background-color: var(--bg-sunk) !important;
  color: var(--fg) !important;
  border-color: var(--line-strong) !important;
}
.dark input::placeholder,
.dark textarea::placeholder { color: var(--fg-3) !important; }
.dark select option { background-color: var(--bg-ink); color: var(--fg); }
```

### 4.1 Rules for staying dark-mode-correct

- **Always use `var(--token)`** for anything that should adapt. Never hardcode a hex
  that needs to change between themes.
- **Text on a `-soft` tint must use the matching `-strong` token.** `var(--neg)` text on
  `var(--neg-soft)` fails WCAG AA in light mode; `var(--neg-strong)` passes. This is the
  single most important color rule. Only `pos` and `neg` ship a `-strong`; for `warn`/`info`
  use the solid token as text on their soft tint and verify contrast.
- **Deliberate exceptions that stay constant in both themes** (don't "fix" these):
  the dark-navy sidebar/bottom-sheet chrome (`#0A1628`, `#B8C9E8`, `#00B4D8`),
  backdrop scrims (navy `rgba(10,22,40,0.35)`), and stage/category identity colors
  that sit on their own alpha tint.

### 4.2 Known dark-mode blind spots in the source (do it right in a rebuild)

The original app has a handful of components that hardcode light-palette hex and
therefore render as light cards on the dark page. If you're rebuilding cleanly, wire
these to tokens:

| Thing | Bug | Fix |
|---|---|---|
| `<Tag>` semantic kinds | `pos/neg/warn/info/accent` use fixed light hex | Use `var(--pos-soft)`/`var(--pos-strong)` etc. |
| `flag()` visit chips | Composes `color+'18'` from raw hex | Same — token-based pill |
| `.r-pill` filter chip, `.live-dot` | Hardcoded light hex | Tokenize (keep `.live-dot` green intentional) |
| A few older drawers/modals | `background:'white'` on the panel | `var(--bg-paper)` |
| Value cell `#0A3D8F`, in-cell auto badge | Fixed navy | `var(--title)` |
| India maps, some progress tracks (`#DDE6F5`) | Light-only | `var(--bg-sunk)` for tracks |
| shadcn `--chart-1..5` oklch ramp | **Dead** — referenced nowhere | Ignore it |

---

## 5. Typography

| Role | Family | Size | Weight | Notes |
|---|---|---|---|---|
| Body / UI | IBM Plex Sans | **13px** / 1.5 | 400 | The default everywhere |
| Numbers, codes, dates, currency, % | **IBM Plex Mono** | inherit | 400 (600 for emphasis) | `tabular-nums`, `letter-spacing:-0.01em`. **Always mono.** |
| Page/section title (uppercase register) | Sans | 10–11px | 700 | uppercase, `letter-spacing 0.08–0.12em`, `var(--title)` |
| Panel title (sentence register) | Sans | 12px | 500 | `letter-spacing:-0.005em`, inherits `var(--fg)` |
| Big metric value | **Mono** | 22–32px | 400–700 | `letter-spacing:-0.02em`, `tabular-nums` |
| Field label | Sans | 10–12px | 500–700 | uppercase for tags/eyebrows |
| Display accent (rare) | Instrument Serif | large | 400 | sparse, decorative only |

Utility classes:

```css
.num, .mono {
  font-family: 'IBM Plex Mono', monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.section-label {  /* the small uppercase eyebrow */
  font-size: 10px; font-weight: 700; color: #6B7FA3;
  text-transform: uppercase; letter-spacing: 0.12em;
}
```

**Two title registers — pick one per surface, don't mix:**
- **Uppercase brand register** (dashboard, admin): `11px / 700 / uppercase / 0.08–0.09em / var(--title)`.
- **Sentence register** (pipeline, compete, most tables): `12px / 500 / -0.005em / inherits color`.

**Color rule for text:** use `--fg` for body copy even at small sizes. `--fg-2` reads
washed-out below 16px — reserve it for headings or medium-weight secondary text.
`--fg-3` is the correct choice for labels/captions/meta. Never pure black or white.

---

## 6. Spacing, radii, shadows, focus, motion

**Radii:** `--radius-sm 4px` (cards inside boards, small chips) · `--radius 6px`
(default: panels, inputs, buttons, columns) · `--radius-lg 10px` · `--radius-xl 14px`
(mobile cards). Rounded pills use `10–12px`; fully-round toggles/count badges use
`999px` / `border-radius:8px` on a 16px box.

**Spacing** is not a strict scale but clusters on: `4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24`.
Canonical desktop page padding is **`22px 24px 40px`** (top / sides / bottom). Panel
header padding **`12px 14px`** (or `12px 16px`). Form/drawer body padding **`20px`**,
field gap **`14–18px`**.

**Shadows** are minimal and mostly navy-tinted:
- Panels in light mode: `0 1px 3px rgba(10,61,143,0.05)` (dark mode: none — the border
  defines the edge).
- Drawer: `-8px 0 40px rgba(10,22,40,0.14)` (or a heavier `rgba(0,0,0,0.35)`).
- Modal: `0 24px 64px rgba(0,0,0,0.2)`.
- Popover/menu: `0 4px 16px rgba(0,0,0,0.12)`.

**Focus (accessibility baseline).** Most controls are inline-styled with no focus ring,
so one global rule provides keyboard focus for everything:

```css
:focus-visible {
  outline: 2px solid var(--brand-blue, #1A5CB8);
  outline-offset: 2px;
  border-radius: 3px;
}
```
`:focus-visible` (not `:focus`) means mouse clicks stay ring-free; only keyboard/AT
focus shows the ring. Reproduce this once, globally — don't add per-component rings.

**Motion.** Restrained. Common transitions: `background 100–120ms`, `border-color 120ms`,
`transform 0.18s` (toggles), `opacity 0.15s`. The drawer slide is
`transform 0.26s cubic-bezier(0.32, 0, 0.67, 0)`. Keyframes in use:

```css
@keyframes pulse-dot { 0%,100% { opacity:1 } 50% { opacity:0.4 } }  /* .live-dot */
@keyframes shimmer   { 0% { background-position:-800px 0 } 100% { background-position:800px 0 } }
@keyframes authFadeIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:none } }
```

Always guard optional animation with `@media (prefers-reduced-motion: reduce)`.

**Skeleton loader:**
```css
.skeleton {
  background: linear-gradient(90deg, #EBF1FB 25%, #DDE6F5 50%, #EBF1FB 75%);
  background-size: 800px 100%;
  animation: shimmer 1.4s ease-in-out infinite;
  border-radius: 4px;
}
```

---

## 7. Component recipes

All recipes are inline-style specs. Values are exact. Anywhere you see a raw hex that
should adapt, prefer the token (noted inline). Redeclare the small constant objects
(`PANEL`, `TH`, `TD`, `INP`, …) per file — there's no shared stylesheet for them.

### 7.1 Buttons

Two "primary blue" contexts exist by convention:
- **In-app primary:** `#0A3D8F` (deep navy-blue) — use `var(--title)`.
- **Auth / marketing primary:** `#1A5CB8` (Risansi blue) — use `var(--brand-blue)`.

```ts
// Primary (solid)
const PRIMARY_BTN = {
  padding: '7px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  background: 'var(--title)', color: '#fff', border: 'none',
  borderRadius: 'var(--radius)', cursor: 'pointer',
};
// Secondary / ghost (outline)
const GHOST_BTN = {
  padding: '7px 14px', fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
  background: 'var(--bg-paper)', color: 'var(--fg-2)',
  border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)', cursor: 'pointer',
};
// Destructive: background var(--neg), color #fff.
// Disabled: opacity 0.7; cursor 'not-allowed'.
// Small (sm): padding '5px 10px', height 30, fontSize 12.
```
- Icon buttons: `28–32px` square, `display:grid; place-items:center`, transparent,
  `color:var(--fg-3)`, `border-radius:4px`.
- No hover styles are defined in the source — the `:focus-visible` ring is the only
  interactive feedback. (Adding a subtle hover bg is a fine enhancement.)
- Solid CTA text is always `#fff`.

### 7.2 Form controls

```ts
const INP = {
  width: '100%', padding: '9px 12px', fontSize: 13, fontFamily: 'inherit',
  background: 'var(--bg-sunk)', color: 'var(--fg)',
  border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)',
  outline: 'none',
};
const LABEL = {
  fontSize: 11, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
```
- **Input well = `var(--bg-sunk)`**, border `var(--line-strong)`. Same recipe for
  `<input>`, `<select>`, `<textarea>`. `<select>` adds `cursor:pointer`.
- Required marker: a `var(--neg)` asterisk after the label.
- Inline validation error: `11px`, `color:var(--neg)` below the field.
- Focus: the global ring covers it; some inputs also add
  `boxShadow: 0 0 0 3px var(--accent-line)` + `border-color: var(--brand-blue)` on focus.
- Native dark chrome is handled by the `.dark input/select/textarea` rules in §4.
- Checkboxes: `accentColor: var(--brand-blue)`.

**Segmented toggle** (e.g. Lead / Client, Sugar / Non-sugar):
```ts
// container
{ display:'inline-flex', border:'1px solid var(--line-strong)',
  borderRadius:7, overflow:'hidden' }
// each segment button
{ padding:'6px 14px', fontSize:12, fontWeight:500, border:'none', cursor:'pointer',
  background:'transparent', color:'var(--fg-2)' }
// active segment
{ background:'var(--brand-blue)', color:'#fff', fontWeight:600 }
// (or use the theme-aware --toggle-sel-bg / --toggle-sel-fg / --toggle-sel-border tokens)
```

### 7.3 Panels & cards

```ts
const PANEL   = { background:'var(--bg-paper)', border:'1px solid var(--line)', borderRadius:'var(--radius)' };
const PANEL_H = { padding:'12px 14px', borderBottom:'1px solid var(--line)', display:'flex', alignItems:'center', gap:8 };
const PANEL_TITLE = { fontSize:12, fontWeight:500, letterSpacing:'-0.005em' }; // sentence register
```
- **No shadow** on the inline `PANEL` (border defines it). A right-aligned meta count
  goes in the header with `marginLeft:'auto'; fontSize:11; color:var(--fg-3)`.
- Rows inside a panel list: `borderBottom:1px solid var(--line)`, omitted on the last row.
- **KPI panel accent:** add `borderLeft: 4px solid var(--title)`.

There's also a **class** variant with a soft shadow + uppercase title, if you want a
`className` hook instead of inline objects:
```css
.panel { background:#FFFFFF; border:1px solid #DDE6F5; border-radius:8px; box-shadow:0 1px 3px rgba(10,61,143,0.05); }
.panel-header { padding:12px 16px; border-bottom:1px solid #EBF1FB; display:flex; align-items:center; justify-content:space-between; }
.panel-title { font-size:11px; font-weight:700; color:#0A3D8F; text-transform:uppercase; letter-spacing:0.09em; }
:root.dark .panel { background:var(--bg-paper); border-color:var(--line); box-shadow:none; }
:root.dark .panel-header { border-bottom-color:var(--line); }
:root.dark .panel-title { color:var(--accent); }
```

**Stat / KPI tiles:**
```ts
// StatCard — static metric tile
outer  = { ...PANEL, padding:'14px 16px' };
label  = { fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--fg-3)', fontWeight:600 };
number = { fontFamily:'var(--font-mono)', fontSize:28, fontWeight:700, color:'var(--fg)', lineHeight:1.1, marginTop:4 };
// value rendered as value.toLocaleString('en-IN'); pass a semantic color token to tint it.
// container: display grid; gridTemplateColumns: repeat(4, 1fr); gap 12.
```

**Clickable KPI facet tile** (doubles as a single-select filter — the interactive stat):
```ts
// <button aria-pressed={active}>
base = {
  textAlign:'left', cursor:'pointer', fontFamily:'inherit',
  background:'var(--bg-paper)',
  border:`1px solid ${active ? accent : 'var(--line)'}`,
  boxShadow: active ? `inset 0 0 0 1px ${accent}` : 'none',
  borderRadius:'var(--radius)', padding:'8px 14px', minWidth:118,
  transition:'border-color 120ms, box-shadow 120ms',
};
// accent = the tile's color prop ?? var(--brand-blue)
// label stays neutral (var(--fg-3)) even when active; number keeps its color.
// Selected state is border + inset ring + colored number ONLY — no tinted background.
// (This deliberately preserves WCAG AA for the small label on mid-tone accents.)
```
Facet colors in use: `var(--pos)`, `var(--neg)`, `var(--warn)`, `var(--purple)`, `var(--title)`.

### 7.4 Data tables

No global `table`/`th`/`td` CSS exists — every table is inline-styled with per-file
`TH` / `TD` constants inside the `PANEL` shell.

```ts
// shell:  <div style={PANEL, overflow:'hidden'}> <div style={{overflowX:'auto'}}> <table>
// <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }} className="r-cards">

const TH = {
  padding:'9px 12px', textAlign:'left', fontSize:10, textTransform:'uppercase',
  letterSpacing:'0.08em', fontWeight:500, color:'var(--fg-3)',
  borderBottom:'1px solid var(--line)', whiteSpace:'nowrap', background:'var(--bg-elev)',
};
const TD = { padding:'10px 12px', verticalAlign:'middle' };
```
- **Header row:** `<tr style={{ background:'var(--bg-elev)' }}>` — set `--bg-elev` on
  **both** the `<tr>` and each `TH` so spread-overridden cells keep the fill. Emphasis
  variant uses `fontSize:11; fontWeight:600; borderBottom:2px solid var(--line)`.
- **Body rows:** `borderBottom:1px solid var(--line)`, `cursor:pointer` when actionable.
  Hover fill is done by **JS inline mutation** (inline styles can't use `:hover`):
  `onMouseEnter={e => e.currentTarget.style.background='var(--bg-elev)'}` /
  `onMouseLeave={… ='transparent'}`, with `transition:'background 100ms'`.
- **Numeric cells:** `{ ...TD, textAlign:'right', fontFamily:'var(--font-mono)' }`
  (`fontWeight:600` for emphasis). Missing values render an em dash `—` in `var(--fg-3)`.
- **Two-line identity cell:** bold name (`12px`, `var(--fg)`) over a mono `10px`
  `var(--fg-3)` code. This cell carries `data-label=""` (empty) so it becomes the card
  title on mobile.
- **Signed delta:** `color = pct>=0 ? 'var(--pos)' : 'var(--neg)'`, text `+12%` / `-4%`.

**In-cell stage/status pill** (colored on its own alpha tint):
```ts
{ padding:'3px 8px', borderRadius:12, fontSize:11, fontWeight:600,
  background:`${stageColor}18`, color:stageColor, border:`1px solid ${stageColor}40` }
// `18` ≈ 9% alpha, `40` ≈ 25% alpha — requires a 6-digit hex.
```

### 7.5 Overlays (drawers, modals, popovers)

Backdrop is always `position:fixed; inset:0` with a navy scrim
**`rgba(10,22,40,0.35)`** (outcome modals use `rgba(0,0,0,0.5)`). Scrim tints are
literal rgba, identical in both themes (a navy scrim reads over light and dark).

**Slide-in right drawer** (create/edit forms):
```ts
// panel — stays MOUNTED so the transform can animate; only the backdrop is gated on `open`
{ position:'fixed', top:0, right:0, bottom:0, width:480,   // 520–560 for wider forms
  background:'var(--bg-paper)', color:'var(--fg)',
  boxShadow:'-8px 0 40px rgba(10,22,40,0.14)',
  display:'flex', flexDirection:'column',
  transform: open ? 'translateX(0)' : 'translateX(100%)',
  transition:'transform 0.26s cubic-bezier(0.32,0,0.67,0)', zIndex:301 }
// header: flexShrink:0; padding '16px 20px'; borderBottom 1px var(--line); title 15px/600 var(--title)
// body:   <form> flex:1; overflowY:auto; padding:20; display:flex; flexDirection:column; gap:18
```

**Centered modal** with a colored header band (outcome capture, quick create):
```ts
// panel
{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
  width:480, background:'var(--bg-paper)', color:'var(--fg)',
  borderRadius:12, overflow:'hidden',              // overflow:hidden clips the header band corners
  boxShadow:'0 24px 64px rgba(0,0,0,0.2)', zIndex:401 }
// colored header band: padding '20px 24px'; color #fff; background = a solid semantic color
//   (Won #065F46 / var(--pos-strong), Lost #991B1B / var(--neg-strong), brand navy, etc.)
//   close × : background rgba(255,255,255,0.2); border none; borderRadius 6; color #fff; 28×28
// body:   padding '20px 24px'; fields flex column gap 14 (or 2-col grid gap 12)
// footer: padding '12px 24px 20px'; borderTop 1px var(--line); flex space-between;
//         ghost cancel (left) + solid submit in the header's color (right)
```

**Dropdown / autocomplete popover:**
```ts
// wrap trigger + menu in position:relative; menu:
{ position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:200,
  background:'var(--bg-paper)', border:'1px solid var(--line-strong)', borderRadius:6,
  boxShadow:'0 4px 16px rgba(0,0,0,0.12)', minWidth:180, maxHeight:260, overflowY:'auto' }
// close on document 'mousedown' when ref.current && !ref.current.contains(e.target)
// autocomplete result rows must use onMouseDown (not onClick) to beat the input's onBlur
```

**z-index ladder** (not centralized in the source — standardize it in a rebuild):
`sticky headers 1` · `sticky tab/footer 8–9` · `tooltips 100` · `filter/sort popovers 200`
· `drawers 300/301` · `modals 400/401` · `lightbox/toast 500` · `mobile bottom-nav 65`,
`more-sheet 70` · `global toast 9999`. **Backdrop = panel − 1.** Pick a tier deliberately
so a drawer doesn't sit under a modal.

### 7.6 Badges, tags, pills, dots

**Tag** — the house label chip (5 semantic kinds + optional dot):
```ts
const TAG_BASE = {
  display:'inline-flex', alignItems:'center', gap:4, padding:'1px 6px',
  fontSize:10, fontWeight:500, textTransform:'uppercase', letterSpacing:'0.06em',
  borderRadius:3, whiteSpace:'nowrap',
  background:'var(--bg-sunk)', color:'var(--fg-2)', border:'1px solid var(--line)',
};
// kind overrides (rebuild → use tokens so they flip):
//   pos → var(--pos-soft) / var(--pos-strong) / border from --pos
//   neg → var(--neg-soft) / var(--neg-strong)
//   warn→ var(--warn-soft) / var(--warn)
//   info→ var(--info-soft) / var(--info)
//   accent→ var(--accent-soft) / var(--brand-blue)
// optional leading dot: 5×5 circle, background:currentColor
```

**Status pill** (the correct token-driven pattern — flips in dark):
```ts
{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:10, whiteSpace:'nowrap' }
// positive: background var(--pos-soft); color var(--pos-strong)   ← -strong is REQUIRED for AA
// neutral:  background var(--bg-sunk);  color var(--fg-3)
```

**StatusDot** — 6px lifecycle dot: `active → var(--pos)`, `inactive → var(--fg-4)`,
`prospect → var(--info)`. `width/height:6; border-radius:50%; flex-shrink:0`.

**Live dot** (the one animated badge):
```css
.live-dot { width:7px; height:7px; border-radius:50%; background:#0E9F6E;
            animation:pulse-dot 2s ease-in-out infinite; display:inline-block; margin-right:6px; }
```

**Removable filter pill** (`.r-pill`) + **count badge**: rounded `12px` chip with a
`×` button; the multi-select trigger shows a circular navy count badge
(`min-width:16; height:16; border-radius:8; background:#0A3D8F; color:#fff; font-size:9; font-weight:700`).
Prefer tokenizing the pill colors in a rebuild.

### 7.7 App shell & navigation

**Frame:** a flex row — fixed 240px sidebar + a scrollable `<main>`.
```ts
// outer: display:flex; height:100vh; overflow:hidden; background:var(--bg)
// main:  flex:1; overflowY:auto; background:var(--bg); minWidth:0   ← minWidth:0 lets wide grids/tables shrink
// per page: column flex → sticky Topbar (top:0; zIndex:10) over a scroller padded 22px 24px 40px
```

**Topbar** (52px): breadcrumbs left, a pulsing `Live · synced` indicator pushed right
with `margin-left:auto`, an inert notifications bell, and an optional primary CTA.
`height:52px; borderBottom:1px solid var(--line); background:var(--bg-paper); padding:0 24px`.
Last breadcrumb crumb is `font-weight:600; color:var(--brand-blue)`.

**Sidebar** (dark navy, both themes):
```ts
// aside: width:240; background:#0A1628; color:#B8C9E8; display:flex; flexDirection:column;
//        borderRight:1px solid rgba(255,255,255,0.06); height:100%; overflowY:auto
// logo card: white chip (background:#fff; borderRadius:8; padding:6px 10px) holding the logo
// group label: 10px; uppercase; letterSpacing:0.12em; color:#00B4D8; fontWeight:600; margin:20px 0 6px 8px
// nav link: flex; gap:10; padding:7px 10px; borderRadius:5; fontSize:13.5; fontWeight:500
//   inactive → color:#B8C9E8; background:transparent
//   active   → color:#fff; background:#1A5CB8  +  a cyan accent bar:
//              span{ position:absolute; left:-8; top:6; bottom:6; width:3; borderRadius:2; background:#00B4D8 }
// icons: inline 15×15 SVG, stroke:currentColor, stroke-width:1.5
// badge: color:#fff; padding:1px 6px; borderRadius:8; fontSize:10; mono;
//        background: alert ? #DC2626 : rgba(255,255,255,0.12)
```
The **UserMenu** pins to the bottom (`margin-top:auto`), opens an upward popup
(`background:#132240`) with the dark-mode toggle switch, Change Password, and Sign out
(`#FF6B6B`). The theme toggle is a `30×16` pill switch, `#1A5CB8` track when dark, a
`12×12` white knob that translates `14px`.

**Tabs** (the canonical in-page pattern, `.field-tabs`): desktop = underline tabs,
active tab `font-weight:600; color:var(--accent)`, `border-bottom:2px solid var(--accent)`
overlapping the strip's `1px` bottom border (`margin-bottom:-1px`). Mobile = scroll-snap
pills. Mark the active tab with `aria-current` (rendered `"true"`).

### 7.8 Kanban / pipeline board

7-column CSS grid, each column an independently scrolling card list capped at `48vh`.

```ts
// board:  className="r-kanban"; display:grid; gridTemplateColumns:repeat(7, minmax(0,1fr)); gap:10
//         minmax(0,1fr) (not 1fr) so long content can't widen a column past its share
// column: background: isOver ? var(--bg-elev) : var(--bg-paper);
//         border: isOver ? '1px dashed var(--accent)' : '1px solid var(--line)'; borderRadius:6
//   header (padding 10px 12px; borderBottom 1px var(--line)):
//     stage name 11px/500/uppercase/0.06em colored by STAGE_COLOR; mono count var(--fg-3);
//     total below in mono 13px var(--fg) → fmtCr(sum)
//   list: padding 8; display:flex; flexDirection:column; gap:8; flex:1; maxHeight:48vh; overflowY:auto
```

```ts
// STAGE_COLOR (identity color = column header text + card left bar)
Suspect: 'var(--info)', Prospect: '#5a86c2', Quoted: '#c69347',
Negotiating: 'var(--accent)', Won: 'var(--pos)', Lost: 'var(--neg)', Dropped: '#64748B'
```

```ts
// Opportunity card
{ position:'relative', border:'1px solid var(--line)', borderRadius:4, padding:10, cursor:'pointer',
  background: Won ? 'var(--won-bg)' : Lost ? 'var(--bg-sunk)' : 'var(--bg-elev)',
  borderLeft: `3px solid ${Won ? '#0E9F6E' : Lost ? '#9CA3AF' : STAGE_COLOR[stage]}`,
  opacity: !canEdit ? 0.85 : Lost ? 0.75 : 1 }
// meta row: mono 10px var(--fg-3), space-between → client code (left) / rep name (right, ellipsis)
// client name: 12px/500 var(--fg);  product: 11px var(--fg-2)
// value: mono 12px/700 var(--brand-blue) → `₹${(value_cr*100).toFixed(1)}L`
// Auto badge: background var(--accent-soft); color var(--brand-blue) — deliberately passes AA on the soft tint
```
Interaction: HTML5 drag-drop on desktop (touch falls back to swipe). A **mandatory
"Quoted" gateway** blocks jumping straight to Won/Lost — a rejected drop fires a fixed
warning toast (`background:var(--warn-soft); color:var(--warn); border:1px solid var(--warn)`)
for 4s. Optimistic moves persist via `PATCH`, reverting on failure.

### 7.9 Data-viz & indicators

Everything is hand-rolled — inline divs + raw SVG. **No charting library.**

- **Numbers** always go through formatters and render in a mono span:
  `fmtCr(v) → "₹12.4 Cr"` (input in Cr, 1dp, null→`—`); `fmtL(v) → "₹1.20 L"` (input in
  Lakhs, 2dp); `formatRev(inr)` auto-scales raw rupees to Cr/L/K; `revDelta → "+12.3%"`.
- **Progress / share bars** — one anatomy: outer track (`background:var(--bg-sunk)`,
  `border-radius:2–4`, `overflow:hidden`) + inner fill (`width:'${pct}%'`, `height:100%`,
  a semantic or category color). Never animated.
- **Sparkline** (SVG): line `stroke-width:1.5`, area path at `opacity:0.12`, `r:2`
  endpoint dot. Default `color:'var(--accent)'`, size ~`80×24`.
- **Donut**: open-arc **stroked** `<path>` slices (not filled wedges), a `foreignObject`
  center for the headline %, and a legend list beside it. Static.
- **Categorical series colors are hardcoded hex maps keyed by name** (competitors,
  funnel stages, segments) — not tokens, because a competitor's color must be stable.
  Example segment order: `[var(--accent), #D97706, #059669, #0891B2, #7C3AED, var(--fg-3), #DC2626, #6366F1]`.
- **Visit-health / recency ramp** (3 stops, raw hex): `≤30d → #0E9F6E green`,
  `31–90d → #D97706 amber`, `>90d / never → #DC2626 red`.
- **Share-quality ramp:** `pct≥50 → var(--pos)`, `25–49 → var(--accent)`, `<25 → var(--neg)`.
- **Sign coloring:** positive = `var(--pos)` + `▲`, negative = `var(--neg)` + `▼`.

---

## 8. Responsive / mobile system

One breakpoint: **`≤767px`**, everything phone-specific in a single
`@media (max-width:767px)` block in `mobile.css`, scoped under `.risansi-main`. Because
visuals are inline styles, mobile overrides use `!important` to win the cascade.

- **Sidebar + Topbar are hidden** (`display:none !important`). Replaced by a fixed
  **56px bottom tab bar** (`.risansi-bottom-nav`, `z-index:65`) with 4 primary tabs + a
  "More" button that opens a **dark-navy bottom sheet** (`z-index:70`). Account actions
  (theme toggle, sign out) that lived in the sidebar UserMenu are duplicated into the
  sheet's Account group, since the sidebar is unreachable on phones.
- **Content clears the bar:** `.risansi-main { padding-bottom: calc(60px + env(safe-area-inset-bottom)) }`.
- **Tables → cards:** add `className="r-cards"` to a `<table>` and a `data-label` to
  every `<td>` (empty `data-label=""` on the title cell). On mobile each row becomes a
  card; each cell shows its `data-label` as an inline `LABEL  value` line. Tables
  *without* `.r-cards` become horizontal scrollers instead.
- **Inline grids auto-collapse:** attribute-substring selectors on
  `[style*="repeat(3"]` / `[style*="repeat(4"]` etc. force 1–2 columns. `repeat(7)`
  (calendars, kanban) opt out; `.r-keepcols` is the manual escape hatch.
- **Kanban** becomes a horizontal scroll-snap swipe row (`.r-kanban` override:
  `grid-auto-flow:column; grid-auto-columns:82%; overflow-x:auto; scroll-snap-type:x mandatory`).
  This rule must appear **after** the generic `repeat(7)` rule to win.
- **Drawers → full-screen** (`.risansi-drawer`, forced `width:100%; z-index:320`);
  **modals → viewport-fit** (`.risansi-modal`).
- **Touch targets:** WCAG 44px enforced via `.r-tap` (buttons), `.field-tabs a`
  (44px min-height pills), `.r-filter-menu label` (44px rows), `.r-pill-x` (28×28).
- **Tabs → pills** with scroll-snap; active pill `background:#1A5CB8; color:#fff`.

Helper classes worth reproducing: `.r-cards`, `.r-keepcols`, `.r-tap`, `.r-page`,
`.r-hide`, `.r-desktop-only`, `.r-mobile-only`, `.r-grid-2/-3/-4`, `.r-stack`, `.r-full`.

---

## 9. Accessibility conventions

- **Contrast:** text on any `-soft` tint uses the matching `-strong` token. Body copy
  uses `--fg` even at small sizes (not `--fg-2`, which is washed out below 16px).
- **Keyboard focus:** the single global `:focus-visible` ring (§6) covers every
  inline-styled control. Don't remove outlines without replacing the ring.
- **Reduced motion:** guard non-essential animation with
  `@media (prefers-reduced-motion: reduce)` (the `.auth-fade` already does).
- **Touch targets:** 44px minimum on interactive controls on phones (§8).
- **Semantics:** interactive stat tiles are real `<button aria-pressed>`; toggles carry
  `aria-label`; tabs use `aria-current`; modal close buttons carry `aria-label`.
- **Native chrome:** `color-scheme` on `:root`/`:root.dark` makes date pickers, selects,
  and scrollbars match the theme.

---

## 10. Auth / login (split-video pattern)

The sign-in and request-access pages share a two-column layout: a full-bleed video
panel on the left (70%), the form on the right (30%). The **video panel persists**
across auth navigations (it lives in the auth-group `layout.tsx`); only the form column
fades in.

- **Grid:** `login-grid` at `7fr 3fr` (`login-brand` = video panel, `login-form` = form).
- **Video panel:** a `<video>` (`/login-bg.mp4`) set `muted`, `playbackRate = 0.75`,
  autoplay/loop, `object-fit:cover`, under a blue overlay
  `linear-gradient(150deg, rgba(10,22,40,0.86), rgba(12,44,96,0.62) 46%, rgba(0,163,196,0.42))`,
  with the logo + tagline on top.
- **Auth register uses `#1A5CB8`** as primary (Risansi blue, not the in-app `#0A3D8F`).
  Auth surfaces are **always light** (fixed hex like `#0D1B2E` text, `#fff` inputs,
  `#6B7F96` secondary) — they don't theme-flip, because the login screen is a fixed
  branded surface.
- **Form fade:** each page's form content is wrapped in `.auth-fade`
  (`authFadeIn 0.4s cubic-bezier(0.16,1,0.3,1)`), guarded by reduced-motion.
- **Auth field constants** (shared): input `padding:'11px 13px'; fontSize:14;
  background:#fff; border:1px solid #DDE4EE; borderRadius:8; color:#0D1B2E`; label
  `fontSize:12; fontWeight:500; color:#2D3E55`; focus → border `#1A5CB8` +
  `boxShadow:0 0 0 3px rgba(26,92,184,0.14)`.
- **Primary auth button:** `#1A5CB8` fill, `#fff`, `borderRadius:8`,
  `boxShadow:0 6px 18px rgba(26,92,184,0.28)`.

Mobile: `login-grid → 1 column`, `login-brand` (video) hidden, form gets its own padding.

---

## 11. Quick-start checklist for a new project

1. `npm install next-themes`.
2. Add `ThemeProvider` (attribute="class", defaultTheme="light", enableSystem={false})
   in the root layout; put `suppressHydrationWarning` on `<html>`.
3. Load IBM Plex Sans (400/500/600), IBM Plex Mono (400), Instrument Serif (400) via
   `next/font/google` as `--font-sans` / `--font-mono` / `--font-serif`; apply the
   `.variable` classes on the app wrapper.
4. Paste the **§3 token block** + the **§4 native-control rules** + the utility classes
   (`.num/.mono`, `.section-label`, `.panel*`, `.live-dot`, `.skeleton`, `:focus-visible`,
   `@media print`) into `globals.css`.
5. Create `mobile.css` with the `@media (max-width:767px)` block (bottom nav, table→cards,
   grid auto-collapse, drawer/modal full-screen, 44px touch targets). Import both CSS
   files in the root layout.
6. Build components with **inline styles reading `var(--token)`** — never hardcode a hex
   that should adapt. Redeclare the `PANEL` / `TH` / `TD` / `INP` constants per file.
7. Numbers, codes, dates, currency → **always** `fontFamily:'var(--font-mono)'` with
   `tabular-nums`, formatted through central helpers.
8. Text on a `-soft` tint → matching `-strong` token. Verify AA.

---

## 12. The non-negotiables (if you remember nothing else)

- Inline styles + CSS-variable tokens. No Tailwind utility classes for visuals.
- Dark mode = `:root.dark` flips values; components read `var(--token)` and never branch.
- IBM Plex Sans 13px body; IBM Plex Mono for every number.
- Navy / Risansi blue / cyan; semantic green-red-amber-blue; never pure black or white.
- 6px default radius, hairline `var(--line)` borders, minimal shadows.
- Dark-navy sidebar in both themes. One 767px breakpoint. One global focus ring.
- `-strong` on `-soft`. That's the contrast rule that keeps it accessible.
```
