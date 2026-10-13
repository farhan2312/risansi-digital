"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";
import { uploadItemOrderCopyAction } from "@/app/risansi/orders/actions";

/**
 * The Order Copy attachment for a Spare EC — shows a download link when a file
 * is present, and (for those who can create orders) an attach/replace picker.
 */
export function OrderCopyCell({
  itemId,
  orderId,
  fileName,
  canEdit,
}: {
  itemId: string;
  orderId: string;
  fileName: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("order_copy", file);
    const res = await uploadItemOrderCopyAction(itemId, orderId, fd);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-card-border bg-surface p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">
            Order Copy
          </h2>
          <p className="mt-1 text-sm text-muted">
            {fileName
              ? "The customer order copy attached to this spare."
              : "No order copy attached yet."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {fileName && (
            <a
              href={`/api/orders/items/${itemId}/order-copy`}
              className="inline-flex h-9 max-w-[240px] items-center gap-1.5 truncate rounded-lg border border-input-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-background"
              download
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{fileName}</span>
            </a>
          )}
          {canEdit && (
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-input-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-background">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {fileName ? "Replace" : "Attach"}
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
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
