/**
 * The shapes the opportunity-remark actions hand back.
 *
 * Here rather than beside the actions because a `'use server'` module may
 * export nothing but async functions — scripts/use-server-export-check.mjs
 * fails the build on a type exported from one.
 */

export interface OppCommentRow {
  id: number;
  body: string;
  author_email: string;
  author_name: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Whether the reader wrote this one, decided on the server.
   *
   * The component could compare emails itself, but then the drawer would have
   * to be told who is looking, and the browser would be the thing deciding
   * who may press Edit. The actions enforce it regardless; this is only so
   * the buttons appear where they will work.
   */
  mine: boolean;
}

export type CommentResult = { ok: true } | { ok: false; error: string };
