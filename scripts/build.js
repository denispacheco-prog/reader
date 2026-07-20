import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const OPML_PATH = path.join(ROOT, 'feeds.opml');
const OUTPUT_PATH = path.join(ROOT, 'reader.json');
const WINDOW_DAYS = 7;
const FETCH_TIMEOUT_MS = 10000;
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

    if (xmlUrlMatch) {
      feeds.push({
        xmlUrl: decodeXmlEntities(xmlUrlMatch[1]),
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
    const parsed = await parser.parseString(xml);
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

  const summaryRaw = item.contentSnippet || item.summary || item.content || '';
  const summary = summaryRaw.trim().slice(0, SUMMARY_MAX_LENGTH);

  return {
    title: (item.title || '(sem título)').trim(),
    link,
    source: sourceName,
    category,
    date: date.toISOString(),
    summary,
  };
}

function dedupeByLink(items) {
  const byLink = new Map();
  for (const item of items) {
    byLink.set(item.link, item);
  }
  return [...byLink.values()];
}

function withinWindow(items, windowDays) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  return items.filter((item) => new Date(item.date).getTime() >= cutoff);
}

async function main() {
  const opmlXml = await readFile(OPML_PATH, 'utf-8');
  const feeds = parseOpml(opmlXml);

  if (feeds.length === 0) {
    console.error('[build] nenhum feed encontrado em feeds.opml');
  }

  console.log(`[build] buscando ${feeds.length} feed(s)...`);
  const results = await Promise.all(feeds.map(fetchFeedItems));
  const allItems = results.flat();

  const deduped = dedupeByLink(allItems);
  const recent = withinWindow(deduped, WINDOW_DAYS);
  recent.sort((a, b) => new Date(b.date) - new Date(a.date));

  const reader = {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    items: recent,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(reader, null, 2), 'utf-8');
  console.log(`[build] reader.json gerado com ${recent.length} item(ns).`);
}

main().catch((err) => {
  console.error('[build] erro fatal:', err);
  process.exit(1);
});
