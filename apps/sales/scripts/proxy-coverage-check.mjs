// Every route is either behind proxy.ts or deliberately exempt.
//
// proxy.ts (Next 16's renamed middleware) is where a withdrawn account is
// stopped. Its jwt callback re-reads `users` on every request, so revoking
// somebody takes effect on their next request rather than when their session
// expires — and because a server action POSTs to the page path it was rendered
// from, the same check covers every action on every matched page.
//
// That only holds while the matcher covers everything. It has been wrong twice,
// and both times the comments in proxy.ts record it after the fact: the print
// views "answered a revoked session in full", and ~40 API handlers read the
// session through getServerSession rather than getCurrentUser, so a status
// check in that helper alone would have missed them.
//
// A new page under a new top-level prefix is the way it goes wrong next. This
// fails the build at that point instead, which is cheaper than finding out from
// somebody who should not have been able to read the page.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// Routes that must NOT be proxied, each with the reason. Keeping the reason here
// is the point: an exemption without one is how a hole gets argued into place.
const EXEMPT = [
  ['/',                          'Redirects to /risansi and renders nothing. No session read, no action called.'],
  ['/change-password',           'A user forced to change their password has to be able to reach this. Its own API route is exempt for the same reason.'],
  ['/api/auth',                  'Sign-in must work for somebody holding no token at all.'],
  ['/api/cron',                  'No session. Guarded by CRON_SECRET instead.'],
];

// ── What proxy.ts actually matches ────────────────────────────────
const proxySrc = fs.readFileSync(path.join(ROOT, 'proxy.ts'), 'utf8');
const matcherBlock = proxySrc.match(/matcher:\s*\[([\s\S]*?)\]/);
if (!matcherBlock) {
  console.log('proxy.ts has no config.matcher array — this check cannot tell what is covered.');
  process.exit(1);
}
const patterns = [...matcherBlock[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
if (!patterns.length) {
  console.log('proxy.ts config.matcher is empty — nothing is behind the proxy.');
  process.exit(1);
}

// '/risansi/:path*' covers /risansi and everything under it: :path* is zero or
// more segments.
const prefixes = patterns.map(p => p.replace(/\/:\w+\*?$/, '') || '/');

const covered = (route) => prefixes.some(p => route === p || route.startsWith(`${p}/`));
const exempt  = (route) => EXEMPT.some(([p]) => route === p || route.startsWith(`${p}/`));

// ── Every route in the app ────────────────────────────────────────
const routes = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (e.name !== 'page.tsx' && e.name !== 'route.ts') continue;
    const rel = path.relative(path.join(ROOT, 'app'), path.dirname(full)).replace(/\\/g, '/');
    routes.push({ route: rel === '.' ? '/' : `/${rel}`, kind: e.name === 'page.tsx' ? 'page' : 'api' });
  }
};
walk(path.join(ROOT, 'app'));

const uncovered = routes.filter(r => !covered(r.route) && !exempt(r.route));

// An exemption for a route that no longer exists is stale, and a stale list is
// one somebody reads and trusts.
const stale = EXEMPT.filter(([p]) => !routes.some(r => r.route === p || r.route.startsWith(`${p}/`)));

console.log(`${routes.length} route(s): ${routes.filter(r => r.kind === 'page').length} page, ${routes.filter(r => r.kind === 'api').length} api`);
console.log(`proxy.ts matches: ${patterns.join(', ')}`);

for (const r of uncovered) {
  console.log(`\n  ${r.route}  (${r.kind})`);
  console.log('    Not matched by proxy.ts and not on the exempt list, so a withdrawn');
  console.log('    account reaches it. Add its prefix to config.matcher in proxy.ts, or');
  console.log('    add it to EXEMPT in this file with the reason it must stay open.');
}
for (const [p, why] of stale) {
  console.log(`\n  EXEMPT lists ${p}, which no longer exists.`);
  console.log(`    Reason given was: ${why}`);
  console.log('    Delete the entry — a stale exemption is one somebody trusts.');
}

if (!uncovered.length && !stale.length) console.log('every route is proxied or exempt with a reason');
process.exit(uncovered.length + stale.length ? 1 : 0);
