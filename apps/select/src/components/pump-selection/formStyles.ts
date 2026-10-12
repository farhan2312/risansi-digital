// Shared Tailwind class strings for the wizard's step forms — comfortable,
// readable spacing (Risansi design guide §7.2: sunk input well, hairline
// strong border, uppercase labels).
//
// Spacing/sizing below uses fixed px (arbitrary values) rather than
// Tailwind's rem-based scale (gap-x-6, px-4, text-base, …). Those rem
// utilities scale with the app's root font-size, which index.css sets to
// 13px ("compact scale") — noticeably tighter than the 16px browser default
// they'd otherwise assume. Fixed px keeps the wizard at the intended wider
// spacing regardless of that root font-size.
//
// Padding uses explicit physical sides (pl-/pr-/pt-/pb-), not px-/py- —
// Tailwind v4 compiles px-/py- to logical properties (padding-inline/
// padding-block), which lose to App.css's physical `* { padding: 0 }` reset
// in some cascade situations. Physical utilities target the same properties
// as that reset, so there's no ambiguity about which one wins.
// Single column on phones, two from `sm` up — a 2-up grid puts ~150px per
// field on a 375px screen, which is too narrow for these inputs.
export const grid = "grid grid-cols-1 sm:grid-cols-2 gap-x-[24px] gap-y-[14px]";
export const fieldWrap = "flex flex-col gap-[5px]";
export const fullWidth = "col-span-1 sm:col-span-2";
export const label =
  "text-[11.5px] font-semibold uppercase tracking-[0.09em] text-fg-3";

// Input control — sunk-tint well with hairline border. On focus lifts to the
// paper background with an accent ring so the active field reads clearly
// against the rest of the form.
export const control =
  "w-full rounded-lg border border-line-strong bg-sunk pl-[14px] pr-[14px] pt-[10px] pb-[10px] text-[14.5px] text-fg outline-none transition-all duration-150 hover:border-fg-3 focus:border-accent focus:bg-paper focus:ring-4 focus:ring-accent-soft focus:shadow-sm";

// Primary CTA — brand-blue fill, subtle lift on hover, disabled shows as
// faded rather than greyed out (keeps colour identity intact).
export const btnPrimary =
  "inline-flex items-center justify-center gap-[8px] rounded-lg bg-title pl-[28px] pr-[28px] pt-[11px] pb-[11px] text-[15px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-accent hover:shadow-[0_4px_14px_rgba(26,92,184,0.28)] active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-sm disabled:hover:bg-title";

// Secondary / ghost — hairline border, fills on hover.
export const btnGhost =
  "inline-flex items-center justify-center gap-[8px] rounded-lg border border-line-strong bg-paper pl-[28px] pr-[28px] pt-[11px] pb-[11px] text-[15px] font-semibold text-fg-2 transition-all duration-150 hover:border-accent hover:text-accent hover:bg-elev active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50";

// Full-width stacked buttons on phones (easier tap targets, no cramped row),
// right-aligned inline from `sm` up.
export const actions =
  "mt-[22px] flex flex-col-reverse sm:flex-row sm:justify-end gap-[12px] [&>button]:w-full sm:[&>button]:w-auto";
export const hint = "text-[12px] text-fg-3";
export const hintError = "text-[12px] text-neg";

// Compact variants for inline rows (e.g. next to a text input).
export const btnPrimarySm =
  "inline-flex items-center gap-[6px] rounded-lg bg-title pl-[16px] pr-[16px] pt-[10px] pb-[10px] text-[13.5px] font-semibold text-white whitespace-nowrap shadow-sm transition-all duration-150 hover:bg-accent hover:shadow-[0_3px_10px_rgba(26,92,184,0.25)] active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-title";
export const btnGhostSm =
  "inline-flex items-center gap-[6px] rounded-lg border border-line-strong bg-paper pl-[16px] pr-[16px] pt-[10px] pb-[10px] text-[13.5px] font-medium text-fg-2 whitespace-nowrap transition-all duration-150 hover:border-fg-3 hover:bg-elev active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50";
