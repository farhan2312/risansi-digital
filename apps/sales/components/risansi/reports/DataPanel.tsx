'use client';

// The left-hand panel: the tables, and the fields on them.
//
// This is the whole semantic model made clickable. It renders straight off
// lib/custom-analytics/model.ts, so a field added there appears here with no
// work, and a field removed there cannot linger.
//
// TWO GROUPS, NOT THREE
//
// The model distinguishes measures (pre-written expressions like "Win rate %")
// from plain numeric columns that need an aggregation picking. That is a real
// distinction and it is not one to put in front of a sales manager, so both
// are "Numbers" here and the aggregation shows up on the chip once the field
// is placed. Everything you can group by is "Group by".
//
// CLICK OR DRAG
//
// Clicking puts the field in whichever well suits it. Dragging lets you say
// which well, for the times the guess is wrong — a date on the legend rather
// than the axis, or a client name counted rather than grouped by.

import { useMemo, useState } from 'react';
import { DATASETS, DATASET_BY_ID, type ModelField } from '@/lib/custom-analytics/model';
import { VISUAL_META, VISUAL_TYPES, type VisualType } from '@/lib/custom-analytics/types';

export const DRAG_TYPE = 'application/x-risansi-field';

export interface FieldDrag { dataset: string; field: string }

export function DataPanel({ dataset, onDataset, onField, onAddCard, cardDataset }: {
  /** The table being browsed. Not necessarily the selected card's table. */
  dataset: string;
  onDataset: (id: string) => void;
  onField: (dataset: string, field: string) => void;
  onAddCard: (type: VisualType) => void;
  /** The selected card's table, so a cross-table number can be marked as one. */
  cardDataset: string | null;
}) {
  const [q, setQ] = useState('');
  const ds = DATASET_BY_ID.get(dataset) ?? DATASETS[0];

  const needle = q.trim().toLowerCase();
  const match = (f: ModelField) =>
    !needle || f.label.toLowerCase().includes(needle) || f.id.includes(needle);

  const fields = ds.fields.filter(match);
  const numbers = fields.filter(f => f.kind !== 'dim');
  const dims = fields.filter(f => f.kind === 'dim');

  // Where else the same search would have found something. Eight tables is
  // too many to click through one at a time looking for "outstanding".
  const elsewhere = useMemo(() => {
    if (!needle) return [];
    return DATASETS
      .filter(d => d.id !== ds.id && d.fields.some(match))
      .map(d => ({ id: d.id, label: d.label, n: d.fields.filter(match).length }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle, ds.id]);

  const foreign = !!cardDataset && cardDataset !== ds.id;

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <Section title="Add a card">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {VISUAL_TYPES.map(t => (
            <button key={t} type="button" onClick={() => onAddCard(t)} style={CHIP_BTN}
              title={`Add a ${VISUAL_META[t].label.toLowerCase()} using ${ds.label}`}>
              {VISUAL_META[t].label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Tables">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {DATASETS.map(d => (
            <button key={d.id} type="button" onClick={() => onDataset(d.id)}
              title={d.description}
              style={{
                ...ROW,
                background: d.id === ds.id ? 'var(--accent-soft)' : 'transparent',
                color: d.id === ds.id ? 'var(--fg)' : 'var(--fg-2)',
                fontWeight: d.id === ds.id ? 600 : 400,
              }}>
              <span aria-hidden style={{ fontSize: 12 }}>{d.icon}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
            </button>
          ))}
        </div>
        <p style={{ margin: '6px 2px 0', fontSize: 10.5, color: 'var(--fg-4)', lineHeight: 1.45 }}>
          {ds.description}
          {ds.dateLabel
            ? ` The page date filter means ${ds.dateLabel.toLowerCase()} here.`
            : ' This table has no date, so the page date filter does not apply to it.'}
        </p>
      </Section>

      <Section title="Fields">
        <input
          type="search" value={q} onChange={e => setQ(e.target.value)}
          placeholder={`Search ${ds.label.toLowerCase()}…`}
          style={{
            width: '100%', boxSizing: 'border-box', background: 'var(--bg)',
            border: '1px solid var(--line)', borderRadius: 5, padding: '4px 7px',
            fontSize: 11.5, color: 'var(--fg)', fontFamily: 'inherit', marginBottom: 6,
          }} />

        {foreign && (
          <p style={{ margin: '0 2px 7px', fontSize: 10.5, color: 'var(--fg-3)', lineHeight: 1.45 }}>
            The card you have selected is built on{' '}
            <strong style={{ color: 'var(--fg-2)' }}>{DATASET_BY_ID.get(cardDataset!)?.label}</strong>.
            A number from {ds.label} can still be added to it; the two are matched on whatever
            they share, such as client or month. Categories have to come from the card&apos;s own table.
          </p>
        )}

        <Group label="Numbers" n={numbers.length}>
          {numbers.map(f => (
            <Field key={f.id} f={f} dataset={ds.id} onClick={onField}
                   suffix={foreign ? `from ${ds.label}` : undefined} />
          ))}
        </Group>
        <Group label="Group by" n={dims.length} dim={foreign}>
          {dims.map(f => (
            <Field key={f.id} f={f} dataset={ds.id} onClick={onField} disabled={foreign} />
          ))}
        </Group>

        {!fields.length && (
          <p style={{ margin: '4px 2px', fontSize: 11, color: 'var(--fg-3)' }}>
            Nothing in {ds.label} matches that.
          </p>
        )}

        {!!elsewhere.length && (
          <p style={{ margin: '8px 2px 0', fontSize: 10.5, color: 'var(--fg-4)', lineHeight: 1.6 }}>
            Also found in{' '}
            {elsewhere.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ', '}
                <button type="button" onClick={() => onDataset(d.id)}
                  style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit',
                           fontSize: 10.5, color: 'var(--accent)', cursor: 'pointer' }}>
                  {d.label} ({d.n})
                </button>
              </span>
            ))}
          </p>
        )}
      </Section>
    </aside>
  );
}

// ── pieces ────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)',
                      borderRadius: 7, padding: '9px 10px' }}>
      <h3 style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                   textTransform: 'uppercase', color: 'var(--fg-3)' }}>{title}</h3>
      {children}
    </section>
  );
}

function Group({ label, n, dim, children }: {
  label: string; n: number; dim?: boolean; children: React.ReactNode;
}) {
  if (!n) return null;
  return (
    <div style={{ marginBottom: 8, opacity: dim ? 0.5 : 1 }}>
      <div style={{ fontSize: 10, color: 'var(--fg-4)', margin: '0 2px 3px' }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</div>
    </div>
  );
}

function Field({ f, dataset, onClick, disabled, suffix }: {
  f: ModelField; dataset: string;
  onClick: (dataset: string, field: string) => void;
  disabled?: boolean; suffix?: string;
}) {
  const title = [f.hint, suffix && `Comes from ${suffix.replace(/^from /, '')}.`,
                 disabled && 'Categories have to come from the card’s own table.']
    .filter(Boolean).join(' ');
  return (
    <button
      type="button"
      draggable={!disabled}
      onDragStart={e => {
        const payload: FieldDrag = { dataset, field: f.id };
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
        // Some browsers refuse a drag with no text/plain alongside it.
        e.dataTransfer.setData('text/plain', f.label);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => !disabled && onClick(dataset, f.id)}
      title={title || f.label}
      style={{ ...ROW, cursor: disabled ? 'default' : 'grab', color: 'var(--fg-2)' }}
    >
      <span aria-hidden style={{ fontSize: 9, color: 'var(--fg-4)', width: 9, flexShrink: 0 }}>
        {f.kind === 'dim' ? (f.date ? '◷' : '▦') : 'Σ'}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
      {f.hint && <span aria-hidden style={{ fontSize: 9, color: 'var(--fg-4)', marginLeft: 'auto' }}>?</span>}
    </button>
  );
}

const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none', borderRadius: 4, padding: '3px 5px',
  fontSize: 11.5, fontFamily: 'inherit', cursor: 'pointer', minWidth: 0,
};

const CHIP_BTN: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 999,
  padding: '3px 9px', fontSize: 11, color: 'var(--fg-2)', cursor: 'pointer', fontFamily: 'inherit',
};
