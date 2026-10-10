'use client';

/**
 * Dark by default, light on request, remembered in localStorage.
 *
 * The toggle itself is the easy half. The hard half is that the *saved*
 * preference has to be on `<html>` before the browser paints anything, or a
 * light-mode visitor sees a dark page flash first — which is why the script in
 * the root layout runs synchronously in <head> and this component only handles
 * the click.
 *
 * Both SVGs are always in the markup; the stylesheet shows one and hides the
 * other off `:root.light`, so switching does not wait on React. That is also
 * why the label is fixed up in an effect rather than rendered from state:
 * nothing React knows during SSR can tell which theme the browser will have.
 */

import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'risansi-theme';

export function ThemeToggle() {
  const button = useRef<HTMLButtonElement>(null);
  const [light, setLight] = useState(false);

  // Read the class the head script already set, after hydration. Rendering
  // from this value instead would be a hydration mismatch on every light-mode
  // load; by the time this runs the correct theme is on screen either way.
  useEffect(() => {
    setLight(document.documentElement.classList.contains('light'));
  }, []);

  function toggle() {
    const root = document.documentElement;
    const nowLight = !root.classList.contains('light');
    root.classList.toggle('light', nowLight);
    try {
      window.localStorage.setItem(STORAGE_KEY, nowLight ? 'light' : 'dark');
    } catch {
      // Private windows and locked-down browsers throw here. The theme still
      // changes for this page; it just will not be remembered.
    }
    setLight(nowLight);
  }

  const label = light ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <button
      ref={button}
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {/* sun (shown in dark mode) */}
      <svg
        className="icon-sun"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7" />
      </svg>
      {/* moon (shown in light mode) */}
      <svg
        className="icon-moon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" />
      </svg>
    </button>
  );
}
