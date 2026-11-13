// SERVER ONLY. The reader's row-level rule, resolved once per request.
//
// This is the only file in the report stack that knows about sessions. The
// engine takes the result rather than the user, which keeps the thing that
// writes SQL independent of the thing that reads cookies - and lets the
// read-only sweep exercise every query without a login.
//
// Each dataset gets the rule the rest of the portal already uses for its
// table, not a new one invented for reports. A rep who cannot see an
// opportunity on the pipeline board must not see it in a report either.

import {
  clientScopeSql, clientVisibilitySql, complaintVisibilitySql, type CurrentUser,
} from '@/lib/risansi-auth';
import { DATASET_SQL } from './sql';
import type { ReportScope } from './engine';

export function buildScope(user: CurrentUser): ReportScope {
  const out: ReportScope = {};
  for (const [id, s] of Object.entries(DATASET_SQL)) {
    out[id] =
      id === 'complaints' ? complaintVisibilitySql(user, 'cm')
      : id === 'clients' || id === 'pumps' || id === 'competitors' ? clientVisibilitySql(user, 'c')
      : clientScopeSql(user, s.scopeCol);
  }
  return out;
}
