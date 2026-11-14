// The training material, as data.
//
// CLIENT-SAFE and pure. Nothing here touches the database.
//
// WHY TRAINING LIVES IN THE REPOSITORY AND NOT IN A SLIDE DECK
//
// Because a deck goes stale the first time a button is renamed, and nobody
// finds out: the deck is on somebody's laptop and the person reading it
// assumes they are the one who is wrong. Every field, well, template, date
// range and visual type named below is declared in `names`, and
// scripts/report-model-check.mjs resolves each one against the model before
// the build runs. Rename "Legend" and the build fails with the topic that
// still calls it something else.
//
// WHY THE PICTURES ARE DRAWN AND NOT PHOTOGRAPHED
//
// Screenshots of this app contain real client names and real revenue, and
// anything under public/ is served without a session — a screenshot there
// would be readable by anybody who guessed the URL. So each topic names a
// `sketch`, and components/risansi/reports/LearnSketch.tsx draws it: invented
// figures, the real layout, correct in both themes, and no file to go stale.
// Real screenshots are for the handout that gets emailed, not for this.

import type { VisualType, Grain, Agg } from './types';
import type { Well } from './build';

/** Who a topic is for. Everybody can read a report; building is rep and above. */
export type Audience = 'everyone' | 'builders';

/**
 * The diagrams LearnSketch.tsx knows how to draw.
 *
 * Adding one here without drawing it fails the build rather than rendering a
 * blank space where the explanation should be.
 */
export const SKETCH_KINDS = [
  'page', 'crossfilter', 'templates', 'wells', 'grid', 'combine', 'filters', 'sheet', 'refusal',
] as const;
export type SketchKind = typeof SKETCH_KINDS[number];

/** Everything a topic's words name, so the build can check they still exist. */
export interface Names {
  wells?: Well[];
  visuals?: VisualType[];
  datasets?: string[];
  /** [dataset, field] pairs. */
  fields?: [string, string][];
  templates?: string[];
  presets?: string[];
  grains?: Grain[];
  aggs?: Agg[];
}

export interface Topic {
  id: string;
  title: string;
  who: Audience;
  /** What this is, and why it is worth a minute. One paragraph. */
  lead: string;
  /** What to do, in order. */
  steps: string[];
  /** The thing people get wrong here. */
  watch?: string;
  sketch?: { kind: SketchKind; caption: string };
  names?: Names;
}

export const TOPICS: Topic[] = [
  {
    id: 'whose-numbers',
    title: 'What a report is, and whose numbers it shows',
    who: 'everyone',
    lead:
      'A report is a page of cards — a figure, a chart, a table — built once and read '
      + 'every month. The important part is who the figures belong to. Every card is '
      + 'computed against the accounts you are allowed to see, at the moment you open '
      + 'it. Not the author\'s accounts, and not a copy taken the day it was built.',
    steps: [
      'Open Reports from the sidebar. Yours are under Mine, anything a colleague sent you is under Shared with me.',
      'Open one. Every card runs its own query against live data while you watch.',
      'A manager and one of their reps open the same shared report and correctly see different totals. Nothing is wrong when that happens — that is the design.',
    ],
    watch:
      'Because the numbers follow the reader, two people quoting "the report" at each '
      + 'other may both be right. Say whose view you are reading from.',
    sketch: { kind: 'page', caption: 'A report page: cards on a grid, filters across the top.' },
  },

  {
    id: 'reading-one',
    title: 'Reading one: pages, dates, and clicking a bar',
    who: 'everyone',
    lead:
      'A report has pages across the top and one filter bar under them. The fastest '
      + 'way to get an answer out of somebody else\'s report is to change the date range '
      + 'and click the bar you are curious about.',
    steps: [
      'Pick a page from the tabs. Each page has its own filters and its own cards.',
      'Change the date range in the filter bar — This FY, Last FY, Last 30 days, or your own two dates.',
      'Click a bar, a slice or a row. Every other card on the page re-reads itself for just that category, and a chip appears saying what is being held.',
      'Click the chip to let it go.',
    ],
    watch:
      'Your filter changes are yours. They are never written back into the report, so '
      + 'you cannot damage something a colleague shared with you by poking at it.',
    sketch: {
      kind: 'crossfilter',
      caption: 'Clicking Maharashtra holds every other card to Maharashtra.',
    },
    names: { presets: ['This FY', 'Last FY', 'Last 30 days'] },
  },

  {
    id: 'start-from-a-template',
    title: 'Start from a template, not a blank page',
    who: 'builders',
    lead:
      'There are four finished reports to copy. Using one gives you your own report, '
      + 'already full of working cards, with your name on it — there is no link back to '
      + 'the template, so change anything you like. This is the right first move even if '
      + 'none of the four is what you want, because a card you can see is easier to '
      + 'change than a blank canvas is to fill.',
    steps: [
      'Reports → Start from a template.',
      'Sales overview is billed revenue and orders in hand. Pipeline health is what is open and what it closed against. Service and complaints is the quality view. Coverage and visits is field activity.',
      'Use this. You land in your own copy, reading it.',
      'Edit, then delete the cards you do not want and add the ones you do.',
    ],
    watch:
      'There is no Production or Inventory template because the portal holds no '
      + 'production, batch, scrap or stock data. A template on either subject would open '
      + 'as a page of empty cards.',
    sketch: { kind: 'templates', caption: 'Four templates, each listing what it answers.' },
    names: { templates: ['sales-overview', 'pipeline-health', 'service-quality', 'coverage'] },
  },

  {
    id: 'first-card',
    title: 'Building your first card',
    who: 'builders',
    lead:
      'The builder has three columns: the tables and their fields down the left, your '
      + 'page in the middle, the selected card\'s contents down the right. Nothing is '
      + 'saved until you press Save, and Discard really does put it back.',
    steps: [
      'Pick a table at the top left — Revenue, Pipeline, Orders (uploaded), Visits, Complaints, Clients.',
      'With nothing selected, click a field. The builder starts a card it thinks suits that field: a Column for a category, a Line for a date, a KPI card for a number.',
      'Click more fields to add them to the card that is selected. Or drag a field straight onto a card.',
      'The card queries real data as you build it, so you can tell whether it is worth keeping before you save.',
      'Save, or press Ctrl+S. Ctrl+Z undoes the last change.',
    ],
    watch:
      'A card with nothing in its Numbers well says so instead of drawing. That is not '
      + 'an error — it is a card you have not finished.',
    names: {
      datasets: ['revenue', 'pipeline', 'orders', 'visits', 'complaints', 'clients'],
      visuals: ['column', 'line', 'kpi'],
      wells: ['values'],
    },
  },

  {
    id: 'wells',
    title: 'The four wells, in plain words',
    who: 'builders',
    lead:
      'Every card is a question with slots. The slots are called wells, and there are '
      + 'four. Which ones a card has depends on its type: a KPI card has only Numbers, a '
      + 'Table has Group by and Numbers, a Column chart has Axis, Legend and Numbers.',
    steps: [
      'Numbers — what is being measured. Revenue ₹, Orders, Complaints, Win rate %.',
      'Axis — what runs along the bottom of a chart: a date, or a category like State.',
      'Legend — splits each bar into coloured parts. One colour per value, eight at most, then the rest is Other.',
      'Group by — tables only. One row per combination of the fields you put here.',
      'A plain number can be summed, averaged, or counted: use the dropdown on its chip. A date can be bucketed by month, quarter or financial year the same way.',
    ],
    watch:
      'A Legend and several Numbers cannot share one scale, so adding a Legend to a '
      + 'chart that already has two numbers drops it to one. The panel does it in front '
      + 'of you rather than drawing something dishonest.',
    sketch: { kind: 'wells', caption: 'The selected card, and the panel that edits it.' },
    names: {
      wells: ['values', 'axis', 'split', 'dims'],
      visuals: ['kpi', 'table', 'column'],
      aggs: ['sum', 'avg', 'countd'],
      grains: ['month', 'quarter', 'fy'],
      fields: [['revenue', 'revenue'], ['orders', 'orders'], ['complaints', 'complaints'],
               ['pipeline', 'win_rate'], ['revenue', 'state']],
    },
  },

  {
    id: 'arranging',
    title: 'Arranging the page',
    who: 'builders',
    lead:
      'Cards sit on a grid twelve columns wide. They cannot overlap: a card you move '
      + 'onto another one pushes it down instead of covering it, which is why the page '
      + 'sometimes shuffles under your hand.',
    steps: [
      'Drag a card by the ⠿ handle in its top right corner. The dashed outline shows where it will land.',
      'Resize from the corner at the bottom right.',
      'Or use the keyboard: click a card, then arrow keys to move it, shift and an arrow to resize, Delete to remove it. Escape lets go.',
      'Tidy up closes the vertical gaps without changing the order.',
      '+ Page adds a page. Pages can be renamed, reordered, duplicated and deleted from the same row.',
    ],
    sketch: { kind: 'grid', caption: 'Twelve columns. A card being dragged shows where it will land.' },
  },

  {
    id: 'two-tables',
    title: 'Two tables on one card',
    who: 'builders',
    lead:
      'The question that sells this feature is "revenue against orders, by client" — and '
      + 'that is two tables. A card is built on one table and can borrow numbers from '
      + 'another, matched on what the two have in common.',
    steps: [
      'Select the card and look at the Numbers well. Under the field list there is "＋ a number from another table…".',
      'Pick one. Order value ₹ from Orders (uploaded) onto a Revenue card grouped by client, for instance.',
      'The card\'s footer then says what the two were matched on: "Two tables, matched on client".',
      'Only tables that can be matched are offered. A card grouped by Drop reason — which only Pipeline has — is offered nothing, and the panel says why rather than letting the card fail later.',
    ],
    watch:
      'Read the footer. "Matched on client" and "matched on month" answer different '
      + 'questions, and a card that does not say which is a card worth distrusting.',
    sketch: { kind: 'combine', caption: 'A Revenue card borrowing Order value ₹, matched on client.' },
    names: {
      datasets: ['revenue', 'orders', 'pipeline'],
      fields: [['orders', 'order_value'], ['revenue', 'client'], ['pipeline', 'drop_reason']],
      wells: ['values', 'dims'],
    },
  },

  {
    id: 'filters',
    title: 'The filters you save, and the filters your readers change',
    who: 'builders',
    lead:
      'The same filter bar does opposite jobs on the two screens, and this is the one '
      + 'thing worth getting straight before you share anything. In the builder it edits '
      + 'the position every reader will open on. In the viewer it is a reading position '
      + 'and is never written back.',
    steps: [
      'Set the date range and filters you want the report to open on, per page, in the builder. Then save.',
      'A reader can change all of it for themselves, and your saved position is untouched.',
      'Set the range by name — This FY, This quarter, Last month — rather than by two dates, so the report still means the same thing next April.',
    ],
    watch:
      'Two hard dates are a snapshot. "This FY" is a report. Pick the name unless you '
      + 'mean the snapshot.',
    sketch: { kind: 'filters', caption: 'The page filter bar. In the builder, this is what readers will open on.' },
    names: { presets: ['This FY', 'This quarter', 'Last month'] },
  },

  {
    id: 'sharing',
    title: 'Sharing it',
    who: 'builders',
    lead:
      'Sharing sends a read-only copy of the page, not of the numbers. Everybody you '
      + 'share with sees the cards you built, computed against their own accounts.',
    steps: [
      'Share, from either the viewer or the builder.',
      'Tick the colleagues who should have it. They get an email and a bell notification once.',
      'They can read it, filter it for themselves, export it, and take a copy. They cannot change yours.',
      'Untick somebody to take it away. It disappears from their Shared with me.',
    ],
    watch:
      'Sharing never widens what somebody can see. If a recipient owns no accounts in '
      + 'Gujarat, your Gujarat card is empty for them, and that is correct.',
    names: { datasets: ['clients'] },
  },

  {
    id: 'excel',
    title: 'Taking it to Excel',
    who: 'everyone',
    lead:
      'Export gives you a real spreadsheet — one sheet per card, headers, number '
      + 'formats, frozen panes. It is not a picture of the screen: the export re-runs '
      + 'every query, so you get the whole table rather than the top few the chart had '
      + 'room to draw.',
    steps: [
      'Export on the card gives you that card. Export at the top of the page gives you every card on it, one sheet each.',
      'Whatever you have filtered, including a clicked category, is applied to the export and written into the sheet so the figures can be accounted for later.',
      'A bar chart drawing the top 15 clients exports as every client. A table that pages 50 rows at a time exports in full.',
    ],
    watch:
      'The sheet is a copy taken at that moment. It does not update, and the report it '
      + 'came from will have moved on by next month.',
    sketch: { kind: 'sheet', caption: 'One sheet per card, with the filters written at the top.' },
  },

  {
    id: 'when-it-says-no',
    title: 'When a card says no',
    who: 'everyone',
    lead:
      'A card that cannot answer honestly says so on its face instead of drawing '
      + 'something plausible. Each message means a different thing and only one of them '
      + 'is a fault.',
    steps: [
      '"This card is not finished", with a list — add a number, pick a table, give the axis something. Nothing has gone wrong; the card is half built.',
      '"Nothing in this range" — the query ran and the answer was genuinely nothing. Usually the date range, or a filter you had forgotten was on.',
      '"This visual took too long" — the question was too broad for the data behind it. Narrow the dates, or group by fewer things.',
      '"Orders (uploaded) can\'t be split by Drop reason" and the like — a real refusal, naming what the two tables could be lined up on instead.',
      '"Showing the top few · why?" at the foot of a chart is not a complaint. Click it: everything outside the top few is added together as Other, so the total is right and only the list is shortened.',
    ],
    sketch: { kind: 'refusal', caption: 'Four messages a card can give, and what each one means.' },
  },
];

export const topicById = (id: string): Topic | null =>
  TOPICS.find(t => t.id === id) ?? null;

/** The topics worth showing somebody who cannot build. */
export const topicsFor = (who: Audience): Topic[] =>
  who === 'builders' ? TOPICS : TOPICS.filter(t => t.who === 'everyone');
