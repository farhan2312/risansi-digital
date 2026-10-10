'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { addContact } from '@/app/actions/risansi';

const DESIGNATIONS = [
  'GM Engineering', 'Chief Engineer', 'Deputy Chief Engineer',
  'Purchase Officer', 'GM Production', 'AGM', 'DGM', 'MD', 'Director',
  'Maintenance Engineer', 'Production Manager', 'Other',
];

export function AddContactDrawer({
  clientId,
  onClose,
}: {
  clientId: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [sameAsPhone, setSameAsPhone] = useState(false);
  const [phoneVal, setPhoneVal]     = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set('client_id', String(clientId));
      if (sameAsPhone) fd.set('whatsapp', phoneVal);
      // A refusal arrives as a value: thrown ones are redacted in production and
      // showed "Failed to add contact" instead of whose client this is.
      const res = await addContact(fd);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add contact');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(10,22,40,0.35)' }}
      />

      {/* Slide-in drawer */}
      <div className="risansi-drawer" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 560, maxWidth: '100vw', zIndex: 50,
        background: 'var(--bg-paper)', boxShadow: '-8px 0 40px rgba(10,22,40,0.14)',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--title)', letterSpacing: '-0.01em' }}>
            Add Contact
          </div>
          <button type="button" onClick={onClose} style={CLOSE_BTN}>✕</button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <Field label="Name" required>
            <input
              type="text" name="name" required minLength={2} maxLength={200}
              placeholder="Full name" style={INP}
            />
          </Field>

          <Field label="Designation">
            <input
              type="text" name="designation" maxLength={200}
              placeholder="GM Engineering, Purchase Officer…"
              list="add-contact-designations" style={INP}
            />
            <datalist id="add-contact-designations">
              {DESIGNATIONS.map(d => <option key={d} value={d} />)}
            </datalist>
          </Field>

          <Field label="Phone">
            <input
              type="tel" name="phone" maxLength={50}
              placeholder="+91 98765 43210" style={INP}
              value={phoneVal}
              onChange={e => setPhoneVal(e.target.value)}
            />
          </Field>

          <Field label="Email">
            <input
              type="email" name="email" maxLength={255}
              placeholder="name@company.com" style={INP}
            />
          </Field>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginBottom: 8 }}>
              <input
                type="checkbox" checked={sameAsPhone}
                onChange={e => setSameAsPhone(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: 'var(--brand-blue)', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>WhatsApp same as phone number</span>
            </label>
            {!sameAsPhone && (
              <Field label="WhatsApp">
                <input
                  type="tel" name="whatsapp" maxLength={50}
                  placeholder="+91 98765 43210" style={INP}
                />
              </Field>
            )}
          </div>

          <Field label="Notes">
            <textarea
              name="notes" rows={3} maxLength={2000}
              placeholder="Relationship context, preferences…"
              style={{ ...INP, height: 'auto', resize: 'vertical' as const, lineHeight: 1.5 }}
            />
          </Field>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer', marginTop: 4 }}>
            <input
              type="checkbox" name="is_primary" value="true"
              style={{ width: 14, height: 14, marginTop: 2, accentColor: 'var(--brand-blue)', cursor: 'pointer', flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>Set as primary contact</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                Removes primary status from any existing primary contact
              </div>
            </div>
          </label>

          {error && (
            <div style={{
              padding: '9px 12px', background: 'var(--neg-soft)',
              border: '1px solid var(--neg)', borderRadius: 5,
              fontSize: 12, color: 'var(--neg-strong)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              ...SUBMIT_BTN,
              opacity: loading ? 0.55 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: 4,
            }}
          >
            {loading ? 'Adding…' : 'Add Contact'}
          </button>
        </form>
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={LBL}>
        {label}
        {required && <span style={{ color: 'var(--neg)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const CLOSE_BTN: CSSProperties = {
  width: 28, height: 28, display: 'grid', placeItems: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 16, color: 'var(--fg-3)', borderRadius: 4,
};

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  fontSize: 13, fontFamily: 'inherit',
  background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg)', outline: 'none',
  boxSizing: 'border-box',
};

const SUBMIT_BTN: CSSProperties = {
  width: '100%', padding: '12px 0', fontSize: 14,
  fontFamily: 'inherit', fontWeight: 600,
  background: 'var(--accent-fill)', color: 'var(--on-accent)',
  border: 'none', borderRadius: 6, letterSpacing: '-0.005em',
};
