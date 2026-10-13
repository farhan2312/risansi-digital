"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip } from "lucide-react";
import { uploadInvoiceLrAction } from "@/app/risansi/orders/actions";

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/**
 * The LR attachment control for one invoice row — shows a download link when a
 * file is present, and (for Dispatch) an attach/replace picker.
 */
export function InvoiceLrCell({
  row,
  orderId,
  canEdit,
}: {
  row: Row;
  orderId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = str(row.id);
  const name = str(row.lr_file_name);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("lr", file);
    const res = await uploadInvoiceLrAction(id, orderId, fd);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {name ? (
          <a
            href={`/api/orders/invoices/${id}/lr`}
            className="inline-flex h-7 max-w-[160px] items-center gap-1 truncate rounded-lg border border-input-border px-2 text-xs font-medium text-foreground transition-colors hover:bg-background"
            download
          >
            <Paperclip className="h-3 w-3 shrink-0" />
            <span className="truncate">{name}</span>
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        {canEdit && (
          <label className="inline-flex h-7 cursor-pointer items-center rounded-lg border border-input-border px-2 text-xs font-medium text-foreground transition-colors hover:bg-background">
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : name ? (
              "Replace"
            ) : (
              "Attach"
            )}
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={onPick}
              disabled={busy}
            />
          </label>
        )}
      </div>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  );
}
