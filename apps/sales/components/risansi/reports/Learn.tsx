// The training page: /risansi/reports/learn
//
// A server component with no state and no JavaScript of its own. The contents
// list is anchors, the diagrams are inline SVG, and the whole thing prints —
// which matters, because the first audience for this is a room with a
// projector and people who will want it on paper afterwards.
//
// WHAT DECIDES WHAT SOMEBODY SEES
//
// `canBuild`. A viewer who cannot build a report does not want eight topics
// about wells and the grid; they want the four that say what a report is,
// how to read one, how to get it into Excel, and what the messages mean.
// Everything else is hidden rather than greyed out.

import Link from 'next/link';
import { TOPICS, topicsFor, type Topic } from '@/lib/custom-analytics/learn';
import { LearnSketch } from './LearnSketch';

export function Learn({ canBuild }: { canBuild: boolean }) {
  const topics = topicsFor(canBuild ? 'builders' : 'everyone');
  const hidden = TOPICS.length - topics.length;

  return (
    <div style={{ padding: '18px 22px 60px', maxWidth: 880, display: 'flex',
                  flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--fg)' }}>
          How reports work
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.6, maxWidth: 620 }}>
          {canBuild
            ? `${topics.length} topics, in the order they are worth reading. The first two are `
              + 'for anybody who opens a report; most of the rest are for building one.'
            : `The ${topics.length} topics that matter for reading a report somebody has shared with you.`}
        </p>
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
          <Link href="/risansi/reports" style={LINK}>Back to Reports</Link>
          {canBuild && <span style={{ color: 'var(--fg-4)', fontSize: 12 }}>·</span>}
          {canBuild && (
            <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>
              Nothing here changes anything. Every step is safe to try on a report of your own.
            </span>
          )}
        </nav>
      </header>

      {/* Contents. Anchors, so it works with no JavaScript and survives print. */}
      <ol style={{ margin: 0, padding: '12px 16px 12px 34px', listStyle: 'decimal',
                   background: 'var(--bg-paper)', border: '1px solid var(--line)',
                   borderRadius: 7, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {topics.map(t => (
          <li key={t.id} style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
            <a href={`#${t.id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{t.title}</a>
          </li>
        ))}
      </ol>

      {topics.map((t, i) => <Section key={t.id} topic={t} n={i + 1} />)}

      {!!hidden && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-4)', lineHeight: 1.6 }}>
          There are {hidden} more topics about building a report. Building is for sales
          reps and above; reading and exporting one is open to everybody.
        </p>
      )}

      <footer style={{ borderTop: '1px solid var(--line)', paddingTop: 12, fontSize: 11.5,
                       color: 'var(--fg-4)', lineHeight: 1.6 }}>
        The pictures on this page are drawings of the screens with invented figures, not
        screenshots. Every field, button and date range they name is checked against the
        report model when the app is built, so a topic cannot quietly go out of date.
      </footer>
    </div>
  );
}

function Section({ topic, n }: { topic: Topic; n: number }) {
  return (
    <section id={topic.id} style={{ display: 'flex', flexDirection: 'column', gap: 9,
                                    scrollMarginTop: 70 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-4)' }}>
          {String(n).padStart(2, '0')}
        </span>
        <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 600, color: 'var(--fg)' }}>
          {topic.title}
        </h2>
        {topic.who === 'builders' && (
          <span style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                         color: 'var(--fg-4)', border: '1px solid var(--line)',
                         borderRadius: 3, padding: '1px 5px' }}>
            building
          </span>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.65 }}>
        {topic.lead}
      </p>

      {/* listStyle is set here on purpose: the CSS reset the app carries for
          its shadcn bridge strips markers from every list, and steps without
          their numbers read as unrelated sentences rather than an order. */}
      <ol style={{ margin: 0, paddingLeft: 20, listStyle: 'decimal', display: 'flex',
                   flexDirection: 'column', gap: 5 }}>
        {topic.steps.map(s => (
          <li key={s} style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>{s}</li>
        ))}
      </ol>

      {topic.watch && (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.6,
                    background: 'var(--accent-soft)', borderLeft: '2px solid var(--accent)',
                    borderRadius: '0 4px 4px 0', padding: '7px 11px' }}>
          <strong style={{ fontWeight: 600, color: 'var(--fg)' }}>Worth knowing. </strong>
          {topic.watch}
        </p>
      )}

      {topic.sketch && (
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)',
                        borderRadius: 7, padding: 10 }}>
            <LearnSketch kind={topic.sketch.kind} />
          </div>
          <figcaption style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>
            {topic.sketch.caption}
          </figcaption>
        </figure>
      )}
    </section>
  );
}

const LINK: React.CSSProperties = {
  fontSize: 12, color: 'var(--accent)', textDecoration: 'none',
};
