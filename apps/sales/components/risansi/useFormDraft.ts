'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Keep what someone typed, even if they never pressed Save.
//
// The visit report already had this idea (useAutoSave in VisitReportForm), but
// only the visit report. Everywhere else, closing a modal, a stray refresh or a
// dropped connection threw the entry away — which is what people were hitting on
// the quotation form.
//
// Two shapes of form need two different answers:
//
//   • A form editing a row that already exists can save field by field to the
//     server. That is the visit report's model.
//   • A form that is STAGING something — the quotation modal, whose Cancel is
//     supposed to revert the card's move, and the create wizard, which has no
//     row until it submits — must not write to the server as you type. Doing so
//     would commit a decision the user hasn't made. Those keep a local draft
//     instead, and restore it when the form is reopened.
//
// This hook is the second kind. It reads the form through FormData, so it covers
// every named input without any of them having to become controlled, and it
// takes an `extra` callback for the parts held in React state (line items, offer
// revisions) that ride in hidden inputs.

export type DraftState = 'idle' | 'saving' | 'saved';

interface Stored<E> { fields: Record<string, string>; extra?: E; at: number }

/** Drafts older than this are stale enough to be more confusing than useful. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function useFormDraft<E = unknown>(
  formRef: React.RefObject<HTMLFormElement | null>,
  key: string | null,
  opts?: {
    /** React-state values that aren't plain inputs (items, revisions). */
    extra?: () => E;
    /** Put those values back when a draft is restored. */
    onRestore?: (extra: E | undefined) => void;
    /** Names never worth keeping (file inputs, hidden ids). */
    skip?: string[];
    debounceMs?: number;
  },
) {
  const [state, setState]       = useState<DraftState>('idle');
  const [restored, setRestored] = useState(false);
  const timer   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settle  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Held in a ref so `capture` stays stable across renders — it's wired to the
  // form's onInput, and a new identity every keystroke would rebind the handler
  // constantly. Updated in an effect, not during render.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const debounce = opts?.debounceMs ?? 600;

  const clear = useCallback(() => {
    if (!key) return;
    try { localStorage.removeItem(key); } catch { /* private mode / quota */ }
    setState('idle');
  }, [key]);

  /** Snapshot the form. Called on every input, debounced. */
  const capture = useCallback(() => {
    if (!key) return;
    const form = formRef.current;
    if (!form) return;
    setState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const fd = new FormData(form);
        const skip = new Set(optsRef.current?.skip ?? []);
        const fields: Record<string, string> = {};
        for (const [k, v] of fd.entries()) {
          if (skip.has(k) || typeof v !== 'string' || v === '') continue;
          fields[k] = v;
        }
        const payload: Stored<E> = { fields, extra: optsRef.current?.extra?.(), at: Date.now() };
        localStorage.setItem(key, JSON.stringify(payload));
        setState('saved');
        clearTimeout(settle.current);
        settle.current = setTimeout(() => setState('idle'), 2200);
      } catch {
        // A full or unavailable localStorage must not break typing.
        setState('idle');
      }
    }, debounce);
  }, [key, formRef, debounce]);

  // Restore once, after the form has mounted and rendered its defaults.
  useEffect(() => {
    if (!key) return;
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); } catch { return; }
    if (!raw) return;

    let stored: Stored<E> | null = null;
    try { stored = JSON.parse(raw) as Stored<E>; } catch { /* corrupt */ }
    if (!stored || !stored.fields) { try { localStorage.removeItem(key); } catch {} return; }
    if (Date.now() - (stored.at ?? 0) > MAX_AGE_MS) { try { localStorage.removeItem(key); } catch {} return; }

    const form = formRef.current;
    if (!form) return;
    let put = 0;
    for (const [name, value] of Object.entries(stored.fields)) {
      const el = form.elements.namedItem(name);
      if (!el) continue;
      // A RadioNodeList (repeated names) isn't safely restorable by position.
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
      if (el.type === 'file') continue;
      // Only fill what the form itself left blank or at its default — never
      // clobber a value the server just supplied with a stale local one.
      // HTMLSelectElement has no defaultValue, so fall back to its value.
      const dflt = el instanceof HTMLSelectElement ? el.value : el.defaultValue;
      if (el.value === '' || el.value === dflt) { el.value = value; put++; }
    }
    optsRef.current?.onRestore?.(stored.extra);
    if (put > 0 || stored.extra !== undefined) setRestored(true);
    // key identifies the record; re-running on anything else would re-restore
    // over live typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(settle.current); }, []);

  return { state, restored, capture, clear, dismissRestored: () => setRestored(false) };
}

// The same idea for a form whose fields live in React state.
//
// The opportunity forms are all controlled — OppStageSections renders the
// catalogue from a `values` record — so there is nothing for FormData to read
// and the hook above cannot see them. This one takes the state itself and keeps
// a JSON copy of it.
//
// It is deliberately still a LOCAL draft rather than a per-field server write.
// The move form composes a stage transition: a drop_reason written the moment it
// is typed would sit on an opportunity still at Quoted, and updateOpportunity
// validates the whole payload and can refuse it outright, so a per-field
// autosave would either store half-states or fail on every keystroke. A draft
// loses nothing and commits nothing.

export function useStateDraft<T>(
  key: string | null,
  snapshot: T,
  opts: {
    /** Put a found draft back into the form's state. Also used to undo a discard. */
    onRestore: (draft: T) => void;
    /** False while the form has no draft worth keeping (a read-only view). */
    enabled?: boolean;
    /**
     * False while the form is still seeding itself from the server. The baseline
     * that decides "has anything been typed" only freezes once this is true, so
     * line items arriving from a fetch don't read as unsaved typing — and the
     * draft is restored after them, not before, so it wins.
     */
    ready?: boolean;
    /** How long the typing has to stop before the label settles on "saved". */
    debounceMs?: number;
  },
) {
  const { enabled = true, ready = true, debounceMs = 700 } = opts;
  const serial = JSON.stringify(snapshot);

  const [state, setState]       = useState<DraftState>('idle');
  const [savedAt, setSavedAt]   = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  // What the form looked like before anyone touched it, and so the measure of
  // whether anything has been. State rather than a ref because `dirty` is read
  // during render — the × and the backdrop both ask it — and has to re-render
  // the form when it moves.
  const [pristine, setPristine] = useState(serial);
  const frozen   = useRef(false);
  const hydrated = useRef(false);
  const settle   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const restore  = useRef(opts.onRestore);
  useEffect(() => { restore.current = opts.onRestore; });

  const dirty = enabled && serial !== pristine;

  // The three effects below all set state, which the lint rule reads as a
  // cascading render and is right to flag in general. Here localStorage IS the
  // external system being synchronised: the baseline follows the form while it
  // seeds itself, the restore reports what it read back, and the label reports
  // what reached storage. None of it has a render-time route.
  /* eslint-disable react-hooks/set-state-in-effect */

  // Follow the form while it is still filling itself in, and take the baseline
  // from the render that first reports `ready` — the one that carries the
  // fetched line items. Stopping a render earlier was enough to make every
  // re-quote open claiming unsaved changes it had not been given.
  //
  // Typing inside that window (a couple of hundred milliseconds) is folded into
  // the baseline, which is the right trade.
  useEffect(() => {
    if (frozen.current) return;
    setPristine(serial);
    if (ready) frozen.current = true;
  }, [ready, serial]);

  // Restore once, on the first render where the frozen baseline is also the
  // state on screen — which is how this waits for the line items rather than
  // overwriting them a moment later.
  useEffect(() => {
    if (!key || !enabled || !frozen.current || hydrated.current) return;
    if (serial !== pristine) return;
    hydrated.current = true;
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); } catch { return; }   // blocked site data
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as { draft?: T; at?: number };
      const stale = Date.now() - (stored?.at ?? 0) > MAX_AGE_MS;
      if (stored?.draft === undefined || stale) { localStorage.removeItem(key); return; }
      // A draft identical to what the form already shows is not news.
      if (JSON.stringify(stored.draft) === pristine) { localStorage.removeItem(key); return; }
      restore.current(stored.draft);
      setRestored(true);
    } catch {
      // Corrupt or unreadable. Dropping it is better than a form that throws.
      try { localStorage.removeItem(key); } catch { /* nothing more to try */ }
    }
  }, [key, enabled, ready, serial, pristine]);

  // Mirror the form into storage, and move the label as it goes.
  useEffect(() => {
    if (!key || !enabled || !hydrated.current) return;
    if (serial === pristine) {
      // Back to untouched — by a discard, or by the typing being undone.
      try { localStorage.removeItem(key); } catch { /* nothing to clean up */ }
      clearTimeout(settle.current);
      setState('idle'); setSavedAt(null);
      return;
    }
    try {
      // Written on every change rather than on the debounce: a backdrop click
      // one keystroke later must still find everything. Only the label waits.
      // serial is already this snapshot as JSON, so it is spliced in rather than
      // stringified a second time.
      localStorage.setItem(key, `{"at":${Date.now()},"draft":${serial}}`);
    } catch {
      // Private browsing, or the quota is full. Typing must not break.
      setState('idle');
      return;
    }
    setState('saving');
    clearTimeout(settle.current);
    settle.current = setTimeout(() => { setState('saved'); setSavedAt(Date.now()); }, debounceMs);
  }, [serial, pristine, key, enabled, debounceMs]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => () => clearTimeout(settle.current), []);

  /** The form saved for real — the draft has served its purpose. */
  const clear = useCallback(() => {
    if (key) { try { localStorage.removeItem(key); } catch { /* nothing to clean up */ } }
    clearTimeout(settle.current);
    setState('idle'); setSavedAt(null); setRestored(false);
  }, [key]);

  /** Throw the draft away and put the form back to how it opened. */
  const discard = useCallback(() => {
    if (key) { try { localStorage.removeItem(key); } catch { /* nothing to clean up */ } }
    try { restore.current(JSON.parse(pristine) as T); } catch { /* baseline is our own JSON */ }
    clearTimeout(settle.current);
    setState('idle'); setSavedAt(null); setRestored(false);
  }, [key, pristine]);

  return { state, savedAt, restored, dirty, clear, discard, dismissRestored: () => setRestored(false) };
}
