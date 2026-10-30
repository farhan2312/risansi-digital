"use client";

import { useState } from "react";

import { control } from "./formStyles";

// Drive step: Motor RPM as three buttons — 960, 1440, Others. Others opens a
// box for any other speed, typed by hand. The value saved is the RPM itself
// ("960", "1440" or what was typed), as before.

const STANDARD = ["960", "1440"];

export default function MotorRpmPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const v = value ?? "";
  // Others is open while chosen, or when a saved speed is neither standard one.
  const [other, setOther] = useState(() => v !== "" && !STANDARD.includes(v));
  const otherOn = other || (v !== "" && !STANDARD.includes(v));

  const btn = (on: boolean) =>
    `rounded-lg border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
      on ? "border-accent bg-accent text-white" : "border-line-strong bg-paper text-fg-2 hover:border-accent hover:text-accent"
    }`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Motor RPM">
        {STANDARD.map((rpm) => (
          <button
            key={rpm}
            type="button"
            aria-pressed={!otherOn && v === rpm}
            className={btn(!otherOn && v === rpm)}
            onClick={() => {
              setOther(false);
              onChange(rpm);
            }}
          >
            {rpm}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={otherOn}
          className={btn(otherOn)}
          onClick={() => {
            if (otherOn) return;
            setOther(true);
            onChange("");
          }}
        >
          Others
        </button>
      </div>
      {otherOn && (
        <input
          type="text"
          inputMode="numeric"
          className={control}
          value={v}
          placeholder="Enter motor RPM, e.g. 720"
          autoFocus={v === ""}
          aria-label="Motor RPM (other)"
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
        />
      )}
    </div>
  );
}
