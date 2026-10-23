// Is a pump on the installed base a PCP or an MMP?
//
// client_pumps records a model plate and nothing else — there is no product
// type on the row — so the only way to split the installed base is to read
// the model. The rule below is not invented: it is what the opportunities
// that carry BOTH a model and a product type actually say.
//
//   RTOH        633 PCP vs   2 MMP
//   RMOH         12 PCP vs   0
//   PSLH          8 PCP vs   0
//   RAH, RBH, RBL, RCDH, RSOH, RTOHAG, RTOHBAG, RTOHV, RTOHVM …  all PCP
//   ZL            9 PCP vs  51 MMP
//   ZLPRO        10 PCP vs  41 MMP
//   PRO           1 PCP vs   5 MMP
//
// So: the R-series and the PS/PM plates are progressive cavity, and the PRO
// and ZL plates are multistage. The handful of rows that cut the other way
// are mis-typed opportunities rather than evidence of a second meaning.
//
// Anything else — '10"x10"', a blank plate, a free-text description — comes
// back null and is counted as a RIL pump whose type we do not know, rather
// than being guessed into one of the two. 116 rows carry no usable plate at
// all and would otherwise be silently filed as PCP.

export type PumpType = 'PCP' | 'MMP';

/** The pump type a model plate implies, or null when it does not say. */
export function pumpTypeOf(modelPlate: string | null | undefined): PumpType | null {
  const m = String(modelPlate ?? '').trim().toUpperCase();
  if (!m) return null;
  // ZL and PRO first: ZLPRO starts with both, and it is multistage.
  if (/^(ZL|PRO)/.test(m)) return 'MMP';
  if (/^(R|PSL|PS|PM)/.test(m)) return 'PCP';
  return null;
}

/** SQL saying the same thing, for counting without pulling every row back. */
export const PUMP_TYPE_SQL = (col: string) => `
  CASE
    WHEN upper(btrim(${col})) ~ '^(ZL|PRO)' THEN 'MMP'
    WHEN upper(btrim(${col})) ~ '^(R|PSL|PS|PM)' THEN 'PCP'
    ELSE NULL
  END`;
