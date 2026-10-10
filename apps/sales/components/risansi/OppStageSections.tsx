'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  fieldsCarriedInto, fieldsNewAt, isFieldRequired, STAGE_HINT,
  type OppStage, type OppFieldDef,
} from '@/lib/risansi-opportunity-fields';
import { OppField, OppFieldRead, FIELD_GRID, type FieldValues } from './OppFields';

// The two-section shape every opportunity form now uses.
//
//   ALREADY RECORDED — everything captured at earlier stages, shown as context.
//                      Read-only by default; "Edit" opens it, because most of it
//                      is correct most of the time and a screen of live inputs
//                      invites accidental edits to a quote number nobody meant
//                      to touch.
//   NOW              — only the fields this stage actually adds.
//
// Both come from one catalogue, so a field cannot appear in both or neither.

export function OppStageSections({
  stage, values, onChange, optionsFor, usdRate, mode = 'advance', children,
}: {
  stage: OppStage;
  values: FieldValues;
  onChange: (name: string, value: string) => void;
  /** Runtime option lists the catalogue cannot hold — competitors, drop reasons. */
  optionsFor?: (f: OppFieldDef) => readonly string[] | undefined;
  usdRate?: number;
  /**
   * 'advance' — the opportunity exists; earlier data is context, read-only until
   *   Edit is pressed.
   * 'create'  — nothing exists yet, so everything up to the chosen stage is being
   *   filled for the first time and every field is open.
   */
  mode?: 'advance' | 'create';
  /** Line items, documents, sales orders — whatever this stage attaches. */
  children?: ReactNode;
}) {
  const carried = fieldsCarriedInto(stage, values);
  const now     = fieldsNewAt(stage, values);
  const creating = mode === 'create';
  // Nothing is "already recorded" when the record does not exist yet.
  const [editingCarried, setEditingCarried] = useState(false);
  const carriedOpen = creating || editingCarried;

  // Something carried in that this stage now demands is worth surfacing rather
  // than leaving buried in a collapsed section — it is the one case where the
  // earlier data genuinely has to change before this stage can be saved.
  const missingCarried = carried.filter(f => isFieldRequired(f, stage) && !values[f.name]?.trim());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {carried.length > 0 && (
        <section>
          <header style={HEAD}>
            <span style={TITLE}>{creating ? 'The enquiry' : 'Already recorded'}</span>
            <span style={SUB}>
              {creating ? 'asked for every opportunity' : 'captured earlier in this deal'}
            </span>
            {!creating && (
              <button type="button" onClick={() => setEditingCarried(v => !v)} style={EDIT}>
                {editingCarried ? 'Done editing' : 'Edit'}
              </button>
            )}
          </header>

          {missingCarried.length > 0 && !creating && (
            <div style={WARN}>
              {missingCarried.length === 1 ? 'This is' : 'These are'} needed before you can save at{' '}
              {stage}: <strong>{missingCarried.map(f => f.label).join(', ')}</strong>.
              {!editingCarried && ' Choose Edit to fill it in.'}
            </div>
          )}

          <div style={{ ...FIELD_GRID, ...PANEL }}>
            {carried.map(f => (
              carriedOpen || missingCarried.includes(f)
                ? <OppField
                    key={f.name} field={f} value={values[f.name] ?? ''}
                    onChange={onChange} usdRate={usdRate} options={optionsFor?.(f)}
                  />
                : <OppFieldRead key={f.name} field={f} value={values[f.name] ?? ''} />
            ))}
          </div>
        </section>
      )}

      <section>
        <header style={HEAD}>
          <span style={TITLE}>{creating ? stage : `Now — ${stage}`}</span>
          <span style={SUB}>{STAGE_HINT[stage]}</span>
        </header>
        <div style={{ ...FIELD_GRID, ...PANEL, ...(creating ? {} : ACTIVE) }}>
          {now.map(f => (
            <OppField
              key={f.name} field={f} value={values[f.name] ?? ''}
              onChange={onChange} usdRate={usdRate} options={optionsFor?.(f)}
            />
          ))}
        </div>
        {children}
      </section>
    </div>
  );
}

const HEAD: CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap',
};
const TITLE: CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--title)',
};
const SUB: CSSProperties = { fontSize: 11, color: 'var(--fg-3)' };
const EDIT: CSSProperties = {
  marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--brand-blue)',
  cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', textDecoration: 'underline',
};
const PANEL: CSSProperties = {
  padding: 14, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-elev)',
};
const ACTIVE: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--title)',
};
const WARN: CSSProperties = {
  fontSize: 11.5, lineHeight: 1.5, marginBottom: 8, padding: '7px 10px', borderRadius: 6,
  color: 'var(--warn-strong)', background: 'var(--warn-soft)',
  border: '1px solid var(--warn)',
};
