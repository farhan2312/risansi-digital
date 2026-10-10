'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A text box whose value also lives in the URL, without eating what is typed.
 *
 * Every one of these boxes debounces a navigation and then takes its value back
 * from the server's render. That is a race, and it lost: type "bala" and the
 * round trip for "bal" — begun three keystrokes ago — lands while "bala" is on
 * screen, the box adopts the older value, and the "a" vanishes under the
 * cursor. Three copies of this existed with three different guards, and all
 * three could be beaten: one had none at all, one compared only against the
 * single most recent push (so a *stale* echo looked like somebody else's
 * change), and one re-pushed on every sync.
 *
 * The rule here is ownership rather than comparison. From the first keystroke
 * the box belongs to the person typing in it, and no echo may touch it. The URL
 * takes it back only once it agrees with what is on screen — at which point
 * there is, by definition, nothing to overwrite. A change from anywhere else (a
 * cleared filter chip, the back button) still lands, because the box is not
 * owned by anyone between edits.
 *
 * @param fromUrl what the URL currently says — from searchParams or a prop
 * @param push    writes a value to the URL; called after `delay` ms of quiet
 */
export function useSearchBox(fromUrl: string, push: (value: string) => void, delay = 300) {
  const [value, setValue] = useState(fromUrl);
  const mine  = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // `push` is usually a fresh closure each render; keeping it in a ref stops a
  // pending debounce from calling a stale one. Written in an effect, not during
  // render, so a concurrent re-render cannot see a half-updated ref.
  const pushRef = useRef(push);
  useEffect(() => { pushRef.current = push; });

  useEffect(() => {
    if (fromUrl === value) { mine.current = false; return; }  // the URL caught up
    if (mine.current) return;                                 // still being typed in
    setValue(fromUrl);                                        // changed somewhere else
  }, [fromUrl, value]);

  const onChange = (next: string) => {
    mine.current = true;
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => pushRef.current(next), delay);
  };

  /** Search now — Enter, or the clear button — without waiting out the delay. */
  const commit = (next = value) => {
    mine.current = true;
    clearTimeout(timer.current);
    setValue(next);
    pushRef.current(next);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return { value, onChange, commit };
}
