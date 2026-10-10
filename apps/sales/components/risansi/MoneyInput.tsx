'use client';

import { useId, useState, type CSSProperties } from 'react';
import { parseMoneyInput, formatIndian } from '@/lib/risansi-money';
import { fmtUsdFromInr } from '@/lib/risansi-offer-revisions';

// A rupee field that keeps what you typed.
//
// These were `type="number"`. A number input whose content isn't a valid
// floating-point number reports "" per the HTML value-sanitisation algorithm,
// and the browser throws it away on blur — so typing 1,50,000, the way amounts
// are written here, and pressing Tab silently emptied the field. That is the
// data-loss people reported.
//
// `type="text"` with inputMode="decimal" keeps the digits and still brings up
// the numeric keypad on a phone. Nothing is ever discarded; the parsing happens
// on the way to the server (parseMoneyInput), and the echo below the field shows
// the figure that will actually be saved, so a typo is visible before Save
// rather than after.

export function MoneyInput({
  name, defaultValue, value, onChange, placeholder, required, disabled,
  usdRate, style, help, id: idIn,
}: {
  name?: string;
  defaultValue?: string | number | null;
  /** Controlled use. Omit for an uncontrolled field with defaultValue. */
  value?: string;
  onChange?: (raw: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** When set, the echo also shows the USD equivalent at this rate. */
  usdRate?: number;
  style?: CSSProperties;
  help?: string;
  id?: string;
}) {
  const autoId = useId();
  const id = idIn ?? autoId;
  const initial = defaultValue == null || defaultValue === '' ? '' : String(defaultValue);
  const [inner, setInner] = useState(initial);
  const raw = value !== undefined ? value : inner;

  const set = (v: string) => {
    if (value === undefined) setInner(v);
    onChange?.(v);
  };

  const parsed = parseMoneyInput(raw);
  // Something was typed but no number could be read out of it — say so rather
  // than silently sending nothing, which is how the old field failed.
  const unreadable = raw.trim() !== '' && parsed == null;

  return (
    <>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={raw}
        onChange={e => set(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        aria-describedby={`${id}-echo`}
        aria-invalid={unreadable || undefined}
        style={{ ...style, ...(unreadable ? { borderColor: 'var(--neg)' } : null) }}
      />
      <div
        id={`${id}-echo`}
        style={{
          fontSize: 10, marginTop: 3, fontFamily: 'var(--font-mono)',
          color: unreadable ? 'var(--neg)' : 'var(--fg-3)', minHeight: 13,
        }}
      >
        {unreadable
          ? "Couldn't read an amount from that"
          : parsed != null
            ? `₹${formatIndian(parsed)}${usdRate ? ` · ≈ ${fmtUsdFromInr(parsed, usdRate)}` : ''}`
            : (help ?? (usdRate ? `commas are fine · at ₹${usdRate}/$` : 'commas are fine'))}
      </div>
    </>
  );
}
