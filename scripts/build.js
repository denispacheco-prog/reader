import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const OPML_PATH = path.join(ROOT, 'feeds.opml');
const OUTPUT_PATH = path.join(ROOT, 'reader.json');
const WINDOW_DAYS = 7;
// Personal blogs post far less often than news sites; 7 days would empty them.
const CATEGORY_WINDOW_DAYS = { Blogs: 30 };
const FETCH_TIMEOUT_MS = 10000;
const FETCH_CONCURRENCY = 20;
const SUMMARY_MAX_LENGTH = 500;
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

// Some feeds behind Cloudflare (e.g. Le Monde Diplomatique, New Scientist,
// Quatro Cinco Um, io9) fetch fine from a residential connection but return
// zero items when this runs in GitHub Actions — Cloudflare's bot protection
// tends to challenge/block traffic from cloud datacenter IP ranges even with
// a normal browser User-Agent. This is a known, accepted limitation (not a
// bug to chase): those feeds just won't reliably appear via the automated
// build, though the OPML entry is kept since it works locally.
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

    return parsed.items
      .map((item) => normalizeItem(item, sourceName, feed.category))
      .filter((item) => item !== null);
  } catch (err) {
    console.error(`[build] falha ao buscar "${feed.title}" (${feed.xmlUrl}): ${err.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeItem(item, sourceName, category) {
  const link = item.link;
  const rawDate = item.isoDate || item.pubDate;
  const date = rawDate ? new Date(rawDate) : null;

  if (!link || !date || Number.isNaN(date.getTime())) {
    return null;
  }

  // Google News appends the outlet to every headline ("Título - Veículo").
  const titleRaw = link.startsWith('https://news.google.com/')
    ? (item.title || '').replace(/ - [^-]+$/, '')
    : item.title;
  const summaryRaw = item.contentSnippet || item.summary || item.content || '';
  const summary = decodeHtmlEntities(summaryRaw).trim().slice(0, SUMMARY_MAX_LENGTH);

  return {
    title: decodeHtmlEntities(titleRaw || '(sem título)').trim(),
    link,
    source: sourceName,
    category,
    date: date.toISOString(),
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
  const cutoffFor = (category) => Date.now() - (CATEGORY_WINDOW_DAYS[category] ?? WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  return items.filter((item) => new Date(item.date).getTime() >= cutoffFor(item.category));
}

async function main() {
  const opmlXml = await readFile(OPML_PATH, 'utf-8');
  const feeds = parseOpml(opmlXml);

  if (feeds.length === 0) {
    console.error('[build] nenhum feed encontrado em feeds.opml');
  }

  console.log(`[build] buscando ${feeds.length} feed(s)...`);
  const results = await mapWithConcurrency(feeds, FETCH_CONCURRENCY, fetchFeedItems);
  const allItems = results.flat();

  const deduped = dedupeByLink(allItems);
  const windowed = withinWindow(deduped);
  windowed.sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = dedupeByTitle(windowed);

  const reader = {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    feeds: feeds.map(({ title, category, htmlUrl }) => ({ title, category, htmlUrl })),
    items: recent,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(reader, null, 2), 'utf-8');
  console.log(
    `[build] reader.json gerado com ${recent.length} item(ns) (${windowed.length - recent.length} manchete(s) repetida(s) removida(s)).`,
  );
}

main().catch((err) => {
  console.error('[build] erro fatal:', err);
  process.exit(1);
});
