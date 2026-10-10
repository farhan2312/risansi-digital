// How a column sorts, in one place.
//
// Every table in the portal should sort on every column, and the first click
// should give the order a person actually wants rather than whatever ascending
// happens to mean for that type:
//
//   text     A to Z            — a name list starts at A
//   number   highest first     — nobody opens a value column to find the smallest
//   date     newest first      — the recent row is the interesting one
//   status   pipeline order    — Quoted before Won before Lost, not alphabetical,
//                                because the sequence IS the meaning
//
// A second click reverses it, a third clears it and returns the table to the
// order the page chose. Clearing matters: several of these tables arrive in a
// deliberate order (longest-sitting first, newest first) that a sort would
// otherwise destroy with no way back.
//
// Two modes, and picking the wrong one is a correctness bug rather than a
// cosmetic one:
//
//   server  the rows on screen are one page of a larger query (LIMIT/OFFSET).
//           Sorting must happen in SQL, because sorting the page you can see
//           reorders twenty rows out of two thousand and silently lies about
//           which are the largest. Use SortableTH, which writes ?sort= & ?dir=.
//   client  every row is already rendered. Sort in memory with useTableSort.

export type SortKind = 'text' | 'number' | 'date' | 'status';
export type SortDir = 'asc' | 'desc';

/** The direction the first click should give, by type. */
export function firstDir(kind: SortKind): SortDir {
  return kind === 'text' || kind === 'status' ? 'asc' : 'desc';
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** No value at all. Not the same as zero, and never sorted as if it were. */
export const isBlank = (v: unknown): boolean => v == null || v === '';

/**
 * Compare two cell values of a given kind, ascending.
 *
 * Blanks always sink to the bottom whichever way the column is pointing — a
 * row with no value is not the smallest value, it is an absence, and floating
 * them to the top of a descending sort buries the rows somebody is looking for.
 */
export function compareBy(kind: SortKind, order?: readonly string[]) {
  return (a: unknown, b: unknown): number => {
    if (isBlank(a) && isBlank(b)) return 0;
    if (isBlank(a)) return 1;
    if (isBlank(b)) return -1;

    switch (kind) {
      case 'number': {
        const x = typeof a === 'number' ? a : parseFloat(String(a).replace(/[^0-9.-]/g, ''));
        const y = typeof b === 'number' ? b : parseFloat(String(b).replace(/[^0-9.-]/g, ''));
        if (Number.isNaN(x) && Number.isNaN(y)) return 0;
        if (Number.isNaN(x)) return 1;
        if (Number.isNaN(y)) return -1;
        return x - y;
      }
      case 'date': {
        // Dates reach here as 'YYYY-MM-DD' text, because every date column in
        // this codebase is cast ::text in SQL. That sorts correctly as a string,
        // and Date.parse is only the fallback for anything that is not.
        const x = String(a), y = String(b);
        const iso = /^\d{4}-\d{2}-\d{2}/;
        if (iso.test(x) && iso.test(y)) return x < y ? -1 : x > y ? 1 : 0;
        const dx = Date.parse(x), dy = Date.parse(y);
        if (Number.isNaN(dx) && Number.isNaN(dy)) return collator.compare(x, y);
        if (Number.isNaN(dx)) return 1;
        if (Number.isNaN(dy)) return -1;
        return dx - dy;
      }
      case 'status': {
        // A status's own sequence, not the alphabet. Anything the list does not
        // name sorts after everything it does, so a new value appears at the end
        // rather than silently landing in the middle.
        const list = order ?? [];
        const x = list.indexOf(String(a)), y = list.indexOf(String(b));
        const xi = x === -1 ? list.length : x;
        const yi = y === -1 ? list.length : y;
        if (xi !== yi) return xi - yi;
        return collator.compare(String(a), String(b));
      }
      default:
        return collator.compare(String(a), String(b));
    }
  };
}

export interface SortState { key: string | null; dir: SortDir }

/**
 * The next state when a header is clicked: first click gives the type's natural
 * direction, second reverses, third clears.
 */
export function nextSort(cur: SortState, key: string, kind: SortKind): SortState {
  if (cur.key !== key) return { key, dir: firstDir(kind) };
  if (cur.dir === firstDir(kind)) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key: null, dir: 'asc' };
}

/** The arrow a header should show. */
export function sortMark(cur: SortState, key: string): '▲' | '▼' | '↕' {
  if (cur.key !== key) return '↕';
  return cur.dir === 'asc' ? '▲' : '▼';
}

export interface SortableColumn<T> {
  key: string;
  kind: SortKind;
  /**
   * What to call this column where there is no header to read it off — the
   * phone sort menu, mostly, because a table in card view has no visible
   * header row at all. A column with no label is left out of that menu rather
   * than listed as its raw key.
   */
  label?: string;
  /** The value to sort on. Give this when the cell renders something other than the raw value. */
  value?: (row: T) => unknown;
  /** For kind 'status': the sequence that defines the order. */
  order?: readonly string[];
}

/**
 * Sort rows by the current state. Returns the original array (not a copy) when
 * nothing is selected, so a table with no sort keeps the order the page chose
 * and React sees the same reference.
 */
export function sortRows<T>(
  rows: T[], cols: SortableColumn<T>[], state: SortState,
): T[] {
  if (!state.key) return rows;
  const col = cols.find(c => c.key === state.key);
  if (!col) return rows;
  // T is deliberately unconstrained. Requiring `T extends Record<string,
  // unknown>` reads as harmless and is not: a TypeScript *interface* does not
  // satisfy an index signature, so every row type in this codebase failed it,
  // and the rows came back out widened to unknown — which then breaks each
  // cell that renders them. The cast is confined to this one read instead.
  const read = col.value ?? ((r: T) => (r as Record<string, unknown>)[col.key]);
  const cmp = compareBy(col.kind, col.order);
  const sign = state.dir === 'asc' ? 1 : -1;
  // Sorting a copy, because a server component may hand the same array to more
  // than one table and reordering in place would reorder both.
  return [...rows].sort((a, b) => {
    const x = read(a), y = read(b);
    // Blanks are settled before the direction is applied. Multiplying the
    // comparator by -1 would reverse them along with everything else and put
    // every empty cell at the TOP of a descending sort, which hides exactly
    // the rows a descending sort is opened to find.
    if (isBlank(x) && isBlank(y)) return 0;
    if (isBlank(x)) return 1;
    if (isBlank(y)) return -1;
    return sign * cmp(x, y);
  });
}
