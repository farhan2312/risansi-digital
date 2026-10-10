'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

// ── Shared photo shape (mirrors the API's metadata response) ──────
interface PhotoMeta {
  id: number;
  mime_type: string;
  byte_size: number;
  caption: string;
  uploaded_by: string | null;
  uploaded_at: string;
}

const MAX_DIM = 1600;       // longest edge after client-side downscale
const JPEG_QUALITY = 0.82;

/**
 * Visit photo capture + gallery. Self-contained: fetches its own list, uploads
 * via the camera (getUserMedia, with a native-camera fallback) or a file
 * browser, and lets the rep caption / delete each photo. Drop it anywhere a
 * `visitId` is in hand. When `disabled` (submitted report) it is read-only.
 */
export function VisitPhotos({
  visitId,
  disabled = false,
}: {
  visitId: string | number;
  disabled?: boolean;
}) {
  const vid = String(visitId);
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [camOpen, setCamOpen] = useState(false);

  const browseRef = useRef<HTMLInputElement>(null);
  const nativeCamRef = useRef<HTMLInputElement>(null);

  // ── Load existing photos ──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/risansi/visits/${vid}/photos`, { cache: 'no-store' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (alive) setPhotos(data.photos ?? []);
      } catch {
        if (alive) setError('Could not load photos.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [vid]);

  // ── Downscale + re-encode before upload so DB rows stay small ──
  const compress = useCallback(async (input: Blob): Promise<Blob> => {
    try {
      const bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
      const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return input;
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
      return blob ?? input;
    } catch {
      return input; // browser couldn't decode it — send the original, server validates
    }
  }, []);

  const uploadOne = useCallback(async (raw: Blob) => {
    setUploading(n => n + 1);
    setError(null);
    try {
      const blob = await compress(raw);
      const fd = new FormData();
      fd.append('photo', blob, 'photo.jpg');
      const res = await fetch(`/api/risansi/visits/${vid}/photos`, { method: 'POST', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Upload failed');
      }
      const { photo } = await res.json();
      setPhotos(p => [...p, photo]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(n => n - 1);
    }
  }, [vid, compress]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) await uploadOne(f);
    }
  }, [uploadOne]);

  const removePhoto = useCallback(async (id: number) => {
    if (typeof window !== 'undefined' && !window.confirm('Remove this photo? This cannot be undone.')) return;
    setError(null);
    setPhotos(prev => {
      const next = prev.filter(x => x.id !== id);
      // Fire the delete; restore on failure.
      fetch(`/api/risansi/visit-photo/${id}`, { method: 'DELETE' })
        .then(res => { if (!res.ok) throw new Error(); })
        .catch(() => { setPhotos(prev); setError('Could not delete the photo.'); });
      return next;
    });
  }, []);

  const takePhoto = () => {
    // Prefer the in-page camera (works on laptop + phone). If the device has no
    // getUserMedia at all, fall back straight to the native camera file input.
    const hasCamera = typeof navigator !== 'undefined'
      && !!navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function';
    if (hasCamera) {
      setCamOpen(true);
    } else {
      nativeCamRef.current?.click();
    }
  };

  const busy = uploading > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!disabled && (
        <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: 0, lineHeight: 1.5 }}>
          Add photos from this visit — site, installed pumps, paperwork. Each is tagged
          automatically with the visit number and time; add your own note next to it.
        </p>
      )}

      {/* Capture / browse actions */}
      {!disabled && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={takePhoto} disabled={busy} style={{ ...ACTION_BTN, ...PRIMARY_BTN }}>
            📷 Take Photo
          </button>
          <button type="button" onClick={() => browseRef.current?.click()} disabled={busy} style={ACTION_BTN}>
            🖼 Browse / Gallery
          </button>
          {busy && (
            <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
              ⟳ Uploading{uploading > 1 ? ` ${uploading}…` : '…'}
            </span>
          )}
          {/* Hidden inputs: multi-select browse, and a native-camera fallback */}
          <input ref={browseRef} type="file" accept="image/*" multiple hidden
            onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
          <input ref={nativeCamRef} type="file" accept="image/*" capture="environment" hidden
            onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: 'var(--neg)', background: 'var(--neg-soft)', padding: '8px 10px', borderRadius: 8 }}>
          {error}
        </div>
      )}

      {/* Gallery */}
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--fg-3)', padding: '8px 0' }}>Loading photos…</div>
      ) : photos.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '24px 16px', border: '1px dashed var(--line-strong)',
          borderRadius: 12, color: 'var(--fg-3)', fontSize: 13,
        }}>
          <div style={{ fontSize: 26, marginBottom: 6 }}>📷</div>
          No photos yet.{!disabled && ' Take one or add from your gallery.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {photos.map(p => (
            <PhotoCard
              key={p.id}
              photo={p}
              prefix={`Visit #${vid} · ${new Date(p.uploaded_at).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}`}
              disabled={disabled}
              onDelete={() => removePhoto(p.id)}
            />
          ))}
        </div>
      )}

      {camOpen && (
        <CameraModal
          onCapture={(blob) => { setCamOpen(false); void uploadOne(blob); }}
          onClose={() => setCamOpen(false)}
          onFallback={() => { setCamOpen(false); nativeCamRef.current?.click(); }}
        />
      )}
    </div>
  );
}

// ── A single photo: thumbnail + fixed prefix + editable caption + delete ──
function PhotoCard({
  photo, prefix, disabled, onDelete,
}: {
  photo: PhotoMeta;
  prefix: string;
  disabled: boolean;
  onDelete: () => void;
}) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChange = (v: string) => {
    setCaption(v);
    setState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await fetch(`/api/risansi/visit-photo/${photo.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caption: v }),
        });
        setState('saved');
        setTimeout(() => setState('idle'), 1500);
      } catch {
        setState('idle');
      }
    }, 700);
  };

  const url = `/api/risansi/visit-photo/${photo.id}`;

  return (
    <div style={{
      display: 'flex', gap: 12, padding: 10, alignItems: 'flex-start',
      background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 12,
    }}>
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, lineHeight: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={caption || prefix}
          width={72}
          height={72}
          style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, background: 'var(--bg-sunk)', display: 'block' }}
        />
      </a>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>
          {prefix}
        </div>
        {disabled ? (
          caption ? (
            <div style={{ fontSize: 13, color: 'var(--fg)', marginTop: 4 }}>{caption}</div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4, fontStyle: 'italic' }}>No note</div>
          )
        ) : (
          <input
            value={caption}
            onChange={e => onChange(e.target.value)}
            placeholder="Add a note (optional)…"
            maxLength={500}
            style={{
              width: '100%', marginTop: 6, height: 38, padding: '0 10px', boxSizing: 'border-box',
              fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)',
              border: '1px solid var(--line-strong)', borderRadius: 8, color: 'var(--fg)', outline: 'none',
            }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, minHeight: 16 }}>
          <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>
            {Math.max(1, Math.round(photo.byte_size / 1024))} KB
          </span>
          {!disabled && state === 'saving' && <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>⟳ Saving…</span>}
          {!disabled && state === 'saved' && <span style={{ fontSize: 10, color: 'var(--pos)' }}>✓ Saved</span>}
          {!disabled && (
            <button type="button" onClick={onDelete} style={{
              marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--neg)', fontSize: 12, fontFamily: 'inherit', padding: '4px 6px',
            }}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── In-page camera (laptop + phone) via getUserMedia ──
function CameraModal({
  onCapture, onClose, onFallback,
}: {
  onCapture: (blob: Blob) => void;
  onClose: () => void;
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setReady(true);
        }
      } catch {
        if (!cancelled) setErr('Camera unavailable or permission denied.');
      }
    })();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(b => { if (b) onCapture(b); }, 'image/jpeg', 0.92);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(8,15,30,0.85)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err ? (
          <div style={{ background: 'var(--bg-paper)', borderRadius: 14, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--fg)', marginBottom: 14 }}>{err}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button type="button" onClick={onFallback} style={{ ...ACTION_BTN, ...PRIMARY_BTN }}>Use device camera</button>
              <button type="button" onClick={onClose} style={ACTION_BTN}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: '100%', borderRadius: 14, background: '#000', aspectRatio: '3 / 4', objectFit: 'cover' }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button type="button" onClick={onClose} style={{ ...ACTION_BTN, background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}>
                Cancel
              </button>
              <button type="button" onClick={snap} disabled={!ready} style={{
                ...ACTION_BTN, ...PRIMARY_BTN, minWidth: 140, opacity: ready ? 1 : 0.5,
              }}>
                ● Capture
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Styles ──
const ACTION_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  minHeight: 44, padding: '0 16px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
  color: 'var(--fg)', borderRadius: 10, cursor: 'pointer',
};

const PRIMARY_BTN: CSSProperties = {
  background: 'var(--accent-fill)', color: 'var(--on-accent)', border: '1px solid var(--accent-fill)',
};
