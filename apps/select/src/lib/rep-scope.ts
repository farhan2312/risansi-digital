// Which enquiries a Rep / Rep Manager may see (lib/roles.ts REP_ROLES).
// Server-only. Read live from Market Intell (read-only), nothing stored:
//
//   - who they are in sales: the sales user linked to their Risansi Digital
//     login (users.identity_user_id), else the same e-mail;
//   - a Rep Manager's team: sales manager_reps (active reps only);
//   - "their own" enquiries: those whose client code is a client the person
//     (or a picked team member) covers in sales as primary OR secondary rep
//     (user, 2026-11-01: both, live). An enquiry whose client code is not in
//     the client master (or has none) falls back to the reps saved on it, by
//     name.
//
// The answer is cached a minute per person (and picked rep): the scope is
// used by every list and every enquiry a rep opens, and a fresh Market
// Intell connection alone costs most of a second.
import { eq, sql, type SQL } from "drizzle-orm";

import type { TokenClaims } from "./auth";
import { db } from "./db";
import { projects, users } from "./db/schema";
import { isMarketIntellConfigured, miQuery } from "./db/market-intell";
import { filterKey } from "./enquiry-filters";
import { isRepRole } from "./roles";

export type RepPerson = { id: number; name: string };

/** A rep's place in sales: themselves and (Rep Manager) the reps under them. */
export type RepContext = { role: string; me: RepPerson | null; team: RepPerson[] };

type Caller = Pick<TokenClaims, "sub" | "role" | "email" | "name">;

const CACHE_MS = 60_000;
const globalForRep = globalThis as unknown as {
  __pumpRepContext?: Map<string, { v: RepContext; at: number }>;
  __pumpRepScope?: Map<string, { v: ScopeLists; at: number }>;
};
const contextCache = (globalForRep.__pumpRepContext ??= new Map());
const scopeCache = (globalForRep.__pumpRepScope ??= new Map());

/** Null when the caller is not a Rep / Rep Manager. */
export async function repContext(caller: Caller): Promise<RepContext | null> {
  if (!isRepRole(caller.role)) return null;
  const key = `${caller.sub}|${caller.role}`;
  const hit = contextCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;

  let me: RepPerson | null = null;
  let team: RepPerson[] = [];
  if (isMarketIntellConfigured()) {
    const [local] = await db.select({ identityUserId: users.identityUserId }).from(users).where(eq(users.id, caller.sub)).limit(1);
    const [row] = await miQuery<{ id: number; name: string }>(
      `SELECT id, name FROM users
        WHERE ($1::uuid IS NOT NULL AND identity_user_id = $1::uuid)
           OR lower(email) = lower($2)
        ORDER BY (identity_user_id = $1::uuid) DESC NULLS LAST
        LIMIT 1`,
      [local?.identityUserId ?? null, caller.email ?? ""],
    );
    me = row ? { id: Number(row.id), name: row.name } : null;
    if (me && caller.role === "rep_manager") {
      team = (
        await miQuery<{ id: number; name: string }>(
          `SELECT u.id, u.name FROM manager_reps mr
             JOIN users u ON u.id = mr.rep_id AND u.is_active
            WHERE mr.manager_id = $1 AND u.id <> $1
            ORDER BY u.name`,
          [me.id],
        )
      ).map((r) => ({ id: Number(r.id), name: r.name }));
    }
  }
  const v: RepContext = { role: caller.role, me, team };
  contextCache.set(key, { v, at: Date.now() });
  return v;
}

type ScopeLists = {
  /** Client codes (upper case) the selected people cover in sales. */
  codes: string[];
  /** Client codes on our enquiries that exist in the client master. */
  known: string[];
  /** filterKey of the selected people's names (the fallback). */
  nameKeys: string[];
};

/** The people a scope covers: a picked team member, else me (+ team). */
function selected(ctx: RepContext, caller: Caller, pickedRep?: string | null): RepPerson[] {
  const all = [...(ctx.me ? [ctx.me] : []), ...ctx.team];
  const picked = pickedRep ? all.find((p) => String(p.id) === String(pickedRep)) : undefined;
  if (picked) return [picked];
  if (all.length) return all;
  // Not linked in sales: only the name fallback, with their portal name.
  return caller.name ? [{ id: -1, name: caller.name }] : [];
}

async function scopeLists(caller: Caller, ctx: RepContext, pickedRep?: string | null): Promise<ScopeLists> {
  const people = selected(ctx, caller, pickedRep);
  const key = `${caller.sub}|${people.map((p) => p.id).join(",")}`;
  const hit = scopeCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;

  const ids = people.map((p) => p.id).filter((id) => id > 0);
  let codes: string[] = [];
  let known: string[] = [];
  if (isMarketIntellConfigured()) {
    const ours = (
      await db.execute<{ c: string }>(
        sql`select distinct upper(trim(${projects.clientCode})) as c from ${projects} where nullif(trim(${projects.clientCode}), '') is not null`,
      )
    ).rows.map((r) => r.c);
    const [mine, existing] = await Promise.all([
      ids.length
        ? miQuery<{ code: string }>(
            `SELECT DISTINCT upper(trim(c.code)) AS code FROM clients c
              WHERE c.deleted_at IS NULL AND nullif(trim(c.code), '') IS NOT NULL
                AND (c.primary_rep_id = ANY($1::int[])
                     OR EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = c.id AND s.rep_id = ANY($1::int[])))`,
            [ids],
          )
        : Promise.resolve([]),
      ours.length
        ? miQuery<{ code: string }>(
            `SELECT DISTINCT upper(trim(code)) AS code FROM clients
              WHERE deleted_at IS NULL AND upper(trim(code)) = ANY($1::text[])`,
            [ours],
          )
        : Promise.resolve([]),
    ]);
    codes = mine.map((r) => r.code);
    known = existing.map((r) => r.code);
  }
  const v: ScopeLists = { codes, known, nameKeys: [...new Set(people.map((p) => filterKey(p.name)).filter(Boolean))] };
  scopeCache.set(key, { v, at: Date.now() });
  return v;
}

const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);
const keyOf = (expr: SQL | typeof projects.clientPrimaryRep) => sql`regexp_replace(lower(coalesce(${expr}, '')), '[^a-z0-9]', '', 'g')`;

/**
 * Condition on `projects` limiting a Rep / Rep Manager to their own
 * enquiries (null for every other role = no limit). `pickedRep` (a sales
 * user id) narrows a Rep Manager to one of their reps, or to themselves.
 */
export async function repScope(caller: Caller, pickedRep?: string | null): Promise<SQL | null> {
  const ctx = await repContext(caller);
  if (!ctx) return null;
  const { codes, known, nameKeys } = await scopeLists(caller, ctx, pickedRep);
  const code = sql`upper(trim(${projects.clientCode}))`;
  const byCode = codes.length ? sql`${code} IN (${list(codes)})` : sql`false`;
  const unknownCode = known.length
    ? sql`(nullif(trim(${projects.clientCode}), '') IS NULL OR ${code} NOT IN (${list(known)}))`
    : sql`true`;
  const byName = nameKeys.length
    ? sql`(${keyOf(projects.clientPrimaryRep)} IN (${list(nameKeys)})
        OR EXISTS (SELECT 1 FROM unnest(string_to_array(${projects.clientSecondaryReps}, ',')) AS s(name)
                    WHERE ${keyOf(sql`s.name`)} IN (${list(nameKeys)})))`
    : sql`false`;
  return sql`(${byCode} OR (${unknownCode} AND ${byName}))`;
}
