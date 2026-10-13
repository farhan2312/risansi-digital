"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { importPiExcelAction } from "@/app/risansi/orders/actions";

/**
 * Upload a PI Excel to auto-fill the Operation card. One click → file picker →
 * the sheet's PI rows are appended to this SO's PI list. Header-matched
 * columns: PI No., PI Date, PI Value.
 */
export function PiExcelUpload({ orderId }: { orderId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onPick(file: File) {
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await importPiExcelAction(orderId, fd);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    const skipped = res.skipped > 0 ? `, ${res.skipped} skipped` : "";
    setMsg({
      ok: true,
      text: `${res.inserted} PI${res.inserted === 1 ? "" : "s"} added${skipped}.`,
    });
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span
          className={`text-[11px] ${msg.ok ? "text-emerald-600" : "text-danger"}`}
        >
          {msg.text}
        </span>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-input-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        Upload PI Excel
      </button>
    </div>
  );
}
