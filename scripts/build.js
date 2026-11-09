import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const OPML_PATH = path.join(ROOT, 'feeds.opml');
const OUTPUT_PATH = path.join(ROOT, 'reader.json');
const FIRST_SEEN_PATH = path.join(ROOT, 'first-seen.json');
const PUBLISHED_FIRST_SEEN_URL = 'https://denispacheco-prog.github.io/reader/first-seen.json';
const WINDOW_DAYS = 7;
// Personal blogs and art sites post far less often than news sites; 7 days
// would empty them. Busy feeds there (e.g. Dezeen) only list their latest
// ~50 items anyway, so the longer window mostly lets the slow ones in.
const CATEGORY_WINDOW_DAYS = { Blogs: 30, 'Arte e Design': 30 };
const DAY_MS = 24 * 60 * 60 * 1000;
const BUILD_TIME = new Date().toISOString();
const FETCH_TIMEOUT_MS = 10000;
const FETCH_CONCURRENCY = 20;
const SUMMARY_MAX_LENGTH = 500;
const MAX_ITEMS_PER_SOURCE = 40;
const FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const parser = new Parser();

function parseOpml(xml) {
  const feeds = [];
  const categoryStack = [];
  const tagRegex = /<outline\b[^>]*\/>|<outline\b[^>]*>|<\/outline>/g;
  const tags = xml.match(tagRegex) || [];

  for (const tag of tags) {
    if (tag === '</outline>') {
      categoryStack.pop();
      continue;
    }

    const titleMatch = tag.match(/\btitle="([^"]*)"/) || tag.match(/\btext="([^"]*)"/);
    const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : null;
    const xmlUrlMatch = tag.match(/\bxmlUrl="([^"]*)"/);
    const htmlUrlMatch = tag.match(/\bhtmlUrl="([^"]*)"/);

    if (xmlUrlMatch) {
      feeds.push({
        xmlUrl: decodeXmlEntities(xmlUrlMatch[1]),
        htmlUrl: htmlUrlMatch ? decodeXmlEntities(htmlUrlMatch[1]) : null,
        title: title || xmlUrlMatch[1],
        category: categoryStack[categoryStack.length - 1] || null,
      });
    } else if (!tag.endsWith('/>')) {
      categoryStack.push(title);
    }
  }

  return feeds;
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
};

// Some feeds double-encode their titles (e.g. "it&#8217;ll", "&amp;#038;"),
// so entities survive XML parsing; decode up to two levels.
function decodeHtmlEntities(str) {
  const decodeOnce = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? match;
  });
  return decodeOnce(decodeOnce(str));
}

function decodeXml(buffer) {
  const preview = Buffer.from(buffer.slice(0, 200)).toString('latin1');
  const match = preview.match(/encoding=["']([^"']+)["']/i);
  const label = match ? match[1].toLowerCase() : 'utf-8';

  try {
    return new TextDecoder(label).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

// Rest of World publishes URLs with bare "&", which is invalid XML. Only escape
// on failure, and skip CDATA, where a bare "&" is valid and must stay as is.
async function parseFeed(xml) {
  try {
    return await parser.parseString(xml);
  } catch {
    return parser.parseString(
      xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>|&(?!#?\w+;)/g, (match) => (match === '&' ? '&amp;' : match)),
    );
  }
}

// Some feeds behind Cloudflare fetch fine from a residential connection but
// return zero items when this runs in GitHub Actions — Cloudflare's bot
// protection tends to challenge/block traffic from cloud datacenter IP ranges
// even with a normal browser User-Agent. This is a known, accepted limitation
// (not a bug to chase). When Google News indexes the site, feeds.opml points
// at a Google News search for it instead (Agência Mural, Le Monde
// Diplomatique); otherwise the feed is dropped.
// Some feeds give no date (Nikkei Asia, Agência FAPESP) or stamp every item
// with the moment the feed was generated (The Korea Times, and date-only
// feeds like Taipei Times that put the whole day at midnight). Those dates
// would pin a feed to the top of its column on every build, so such items
// get the time a build first saw them instead. The first sightings travel
// from build to build in first-seen.json, published next to reader.json.
let previousFirstSeen = new Map();
const firstSeen = new Map();

function withTrustedDates(items) {
  const dates = items.map((item) => item.date);
  const allStamped = items.length >= 5 && dates.every((date) => date && date === dates[0]);
  return items.map((item) => {
    if (item.date && !allStamped) return item;
    const date = previousFirstSeen.get(item.link) || BUILD_TIME;
    firstSeen.set(item.link, date);
    return { ...item, date };
  });
}

async function loadPreviousFirstSeen() {
  try {
    const response = await fetch(PUBLISHED_FIRST_SEEN_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Map(Object.entries(await response.json()));
  } catch (err) {
    console.error(`[build] first-seen.json anterior indisponível (${err.message}); itens sem data confiável usam o horário deste build`);
    return new Map();
  }
}

// Keep what this build saw, plus earlier sightings still inside the longest
// window, so a feed that fails once doesn't have its items re-stamped as new.
function firstSeenToSave() {
  const keepMs = (Math.max(WINDOW_DAYS, ...Object.values(CATEGORY_WINDOW_DAYS)) + 1) * DAY_MS;
  const saved = new Map(firstSeen);
  previousFirstSeen.forEach((date, link) => {
    if (!saved.has(link) && Date.now() - new Date(date).getTime() < keepMs) saved.set(link, date);
  });
  return Object.fromEntries(saved);
}

async function fetchFeedItems(feed) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(feed.xmlUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': FETCH_USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const xml = decodeXml(await response.arrayBuffer());
    const parsed = await parseFeed(xml);
    const sourceName = feed.title || parsed.title || feed.xmlUrl;

    const items = parsed.items
      .map((item) => normalizeItem(item, sourceName, feed.category))
      .filter((item) => item !== null);
    return withTrustedDates(items);
  } catch (err) {
    console.error(`[build] falha ao buscar "${feed.title}" (${feed.xmlUrl}): ${err.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// A Google News site search also returns navigation pages: archives, author
// pages, issue covers and, for Alesp, contract and bill records.
const GOOGLE_NEWS_NOISE = [
  /^Arquivos\b/,
  /Página \d+ de \d+/,
  /, Autor em /,
  /^Edição\b/,
  /^Processo de Contrato\b/,
  /^Projeto de Lei [\d.]+\/\d{4}$/,
  /^\d+ª Sessão (Ordinária|Extraordinária|Solene)$/,
  /^(Banco de Notícias|Legislação Estadual|Sua quebrada)$/,
];

// Feeds that mix walkthroughs and guides into their news, with no news-only
// feed to subscribe to instead.
const LINK_NOISE = [/^https:\/\/www\.videogameschronicle\.com\/guide\//];

function normalizeItem(item, sourceName, category) {
  const link = item.link;
  const rawDate = item.isoDate || item.pubDate;
  const parsedDate = rawDate ? new Date(rawDate) : null;
  // Undated items are kept; withTrustedDates fills in when they were first seen.
  const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

  if (!link) {
    return null;
  }

  if (LINK_NOISE.some((pattern) => pattern.test(link))) {
    return null;
  }

  // A wrong future date (BBC Culture once sent one weeks ahead) would pin the
  // item to the top of its column; allow a day of slack for time zones.
  if (date && date.getTime() > Date.now() + DAY_MS) {
    return null;
  }

  // Google News appends the outlet to every headline ("Título - Veículo").
  const fromGoogleNews = link.startsWith('https://news.google.com/');
  const titleRaw = fromGoogleNews ? (item.title || '').replace(/ - [^-]+$/, '') : item.title;
  if (fromGoogleNews && GOOGLE_NEWS_NOISE.some((pattern) => pattern.test(titleRaw.trim()))) {
    return null;
  }
  const summaryRaw = item.contentSnippet || item.summary || item.content || '';
  const summary = decodeHtmlEntities(summaryRaw).trim().slice(0, SUMMARY_MAX_LENGTH);

  return {
    title: decodeHtmlEntities(titleRaw || '(sem título)').trim(),
    link,
    source: sourceName,
    category,
    date: date ? date.toISOString() : null,
    summary,
  };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function dedupeByLink(items) {
  const byLink = new Map();
  for (const item of items) {
    byLink.set(item.link, item);
  }
  return [...byLink.values()];
}

// Sibling feeds (e.g. two Folha sections) often carry the same story under
// different links. Keep one copy per headline within each category; expects
// items sorted newest first, so the newest copy wins.
function dedupeByTitle(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.category}|${item.title.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withinWindow(items) {
  const cutoffFor = (category) => Date.now() - (CATEGORY_WINDOW_DAYS[category] ?? WINDOW_DAYS) * DAY_MS;
  return items.filter((item) => new Date(item.date).getTime() >= cutoffFor(item.category));
}

// Firehose feeds (Folha sections, Axios, g1...) post ~100 items a week and
// would crowd their columns and bloat reader.json; keep each source's newest
// MAX_ITEMS_PER_SOURCE. Expects items sorted newest first.
function capPerSource(items) {
  const counts = new Map();
  return items.filter((item) => {
    const count = (counts.get(item.source) || 0) + 1;
    counts.set(item.source, count);
    return count <= MAX_ITEMS_PER_SOURCE;
  });
}

async function main() {
  const opmlXml = await readFile(OPML_PATH, 'utf-8');
  const feeds = parseOpml(opmlXml);

  if (feeds.length === 0) {
    console.error('[build] nenhum feed encontrado em feeds.opml');
  }

  previousFirstSeen = await loadPreviousFirstSeen();
  console.log(`[build] buscando ${feeds.length} feed(s)...`);
  const results = await mapWithConcurrency(feeds, FETCH_CONCURRENCY, fetchFeedItems);
  const allItems = results.flat();

  const deduped = dedupeByLink(allItems);
  const windowed = withinWindow(deduped);
  windowed.sort((a, b) => new Date(b.date) - new Date(a.date));
  const unique = dedupeByTitle(windowed);
  const recent = capPerSource(unique);

  const reader = {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    feeds: feeds.map(({ title, category, htmlUrl }) => ({ title, category, htmlUrl })),
    items: recent,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(reader, null, 2), 'utf-8');
  await writeFile(FIRST_SEEN_PATH, JSON.stringify(firstSeenToSave()), 'utf-8');
  console.log(
    `[build] reader.json gerado com ${recent.length} item(ns) (${windowed.length - unique.length} manchete(s) repetida(s) e ${unique.length - recent.length} acima do teto por fonte removidos).`,
  );
}

main().catch((err) => {
  console.error('[build] erro fatal:', err);
  process.exit(1);
});
