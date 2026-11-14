import type { CompareResult } from '@/lib/risansi-so-compare';

/**
 * The shapes the SO-portal server actions hand back.
 *
 * They live here rather than beside the actions because a `'use server'`
 * module may export nothing but async functions — a type exported from one is
 * a build failure (scripts/use-server-export-check.mjs), and a confusing one.
 */

export type SoVerdict =
  /** The dispatch portal has this SO. */
  | { soNo: string; state: 'found'; status: string | null; valueCr: number | null;
      otherClient: boolean; oppHasCode: boolean }
  /** It does not. Either a typo, or that system has not caught up yet. */
  | { soNo: string; state: 'missing' }
  /** That system could not be reached. Not the same as missing. */
  | { soNo: string; state: 'unknown' };

export interface SoComparison extends CompareResult {
  soNumbers: string[];
  /** Recorded here, unknown there. */
  soNotFound: string[];
  quotedLineCount: number;
}
