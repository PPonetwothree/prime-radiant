// Collects reports from Google News (per country) and from outlets' own RSS
// feeds, tags them, stores them in SQLite, and keeps a clustered 48h view in
// memory for the live feed.

import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import {
  classifyCategory,
  classifySeverity,
  isOffTopic,
  isForeignOnly,
  resolveCountry,
  detectCountry,
  tokens,
  similarity,
} from './classify.js';
import { FEEDS, SKIP_SOURCES, sourceInfo } from './sources.js';
import { saveArticles, recentArticles, pruneOld, recordFeed } from './db.js';
import { runTagger } from './tagger.js';
import { evaluateAlerts } from './alerts.js';

export const COUNTRIES = ['Pakistan', 'China', 'Bangladesh', 'Myanmar', 'Nepal', 'Bhutan', 'Afghanistan'];

const LIVE_WINDOW_MS = 48 * 3600 * 1000;
const SAME_STORY = 0.6; // share of headline words two reports need in common
const CONCURRENCY = 8;
const USER_AGENT = 'Mozilla/5.0 (compatible; OSINT-Dashboard/1.2; +RSS reader)';

const googleUrl = (country) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${country} when:1d`)}&hl=en-IN&gl=IN&ceid=IN:en`;

const GOOGLE_FEEDS = COUNTRIES.map((country) => ({
  id: `google-${country.toLowerCase()}`,
  name: `Google News: ${country}`,
  country,
  url: googleUrl(country),
  google: true,
}));

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: '#text' });

const state = {
  articles: [], // clustered, newest first
  lastRefresh: null,
  lastError: null,
};

// ── Text helpers ─────────────────────────────────────────
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);

export const stripHtml = (s) =>
  decode(
    String(s)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();

const textOf = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  return v['#text'] ?? v.href ?? '';
};

const linkOf = (item) => {
  const l = item.link;
  if (Array.isArray(l)) {
    const alt = l.find((x) => !x.rel || x.rel === 'alternate') || l[0];
    return textOf(alt);
  }
  return textOf(l) || textOf(item.guid);
};

// Cut at a word boundary; WordPress feeds also append "The post X appeared first on Y."
const trimWords = (s, max) => {
  const clean = s.replace(/\s*The post .* appeared first on .*$/i, '').replace(/\s*\[(…|&hellip;|\.\.\.)\]\s*$/, '');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.\s]+$/, '')}…`;
};

const idFor = (url) => createHash('sha1').update(url).digest('hex').slice(0, 16);

// Kathmandu Post and some others omit dates but put them in the URL.
const dateFromUrl = (url) => {
  const m = url.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 12) : null;
};

// ── Parsing ──────────────────────────────────────────────
const parseItems = (xml) => {
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item || doc?.feed?.entry || doc?.['rdf:RDF']?.item || [];
  return (Array.isArray(raw) ? raw : [raw]).map((item) => ({
    title: stripHtml(textOf(item.title)),
    link: linkOf(item).trim(),
    date: textOf(item.pubDate) || textOf(item.published) || textOf(item.updated) || textOf(item['dc:date']),
    description: textOf(item.description) || textOf(item.summary) || textOf(item['content:encoded']),
    source: textOf(item.source),
  }));
};

// Outlets file sport and entertainment under these URL sections.
const OFF_TOPIC_PATH = /\/(sports?|cricket|football|entertainment|showbiz|lifestyle|life-style|fashion|celebrity|bollywood|films?|movies?|horoscope|recipes?|travel)(\/|$|-)/i;

const toArticle = (item, feed, now) => {
  let headline = item.title;
  let source = feed.name;
  if (feed.google) {
    source = item.source || 'Unknown source';
    // Google News appends " - Source" to every title.
    if (headline.endsWith(` - ${source}`)) headline = headline.slice(0, -(source.length + 3));
  }
  const url = item.link;
  if (!headline || !/^https?:\/\//.test(url) || isOffTopic(headline) || SKIP_SOURCES.test(source)) return null;
  if (OFF_TOPIC_PATH.test(url)) return null;

  // Google's description is only a link back to itself; outlets' is a real dek.
  const summary = feed.google ? null : trimWords(stripHtml(item.description), 320) || null;

  if (feed.country && isForeignOnly(headline)) return null;

  const country = feed.country
    ? resolveCountry(headline, feed.country)
    : detectCountry(`${headline} ${summary || ''}`);
  if (!country) return null; // regional outlet, story not about our countries

  let published = Date.parse(item.date);
  if (Number.isNaN(published)) published = dateFromUrl(url) ?? now;
  if (published > now + 3600e3) published = now; // clock skew / bad dates

  return {
    id: idFor(url),
    headline,
    summary,
    source,
    url,
    country,
    category: 'Internal Affairs', // set by tag()
    severity: 'Routine',
    published,
    first_seen: now,
    origin: feed.google ? 'google' : feed.id,
  };
};

// Rules are re-applied on every read, so editing classify.js takes effect immediately.
const tag = (a) => {
  let category = classifyCategory(a.headline);
  if (category === 'Internal Affairs' && a.summary) category = classifyCategory(a.summary);
  return { ...a, category, severity: classifySeverity(a.headline) };
};

// ── Fetching ─────────────────────────────────────────────
const request = (url) =>
  fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });

const fetchFeed = async (feed) => {
  const now = Date.now();
  try {
    let res;
    try {
      res = await request(feed.url);
    } catch {
      // One retry for dropped connections; HTTP errors are not retried.
      await new Promise((r) => setTimeout(r, 3000));
      res = await request(feed.url);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseItems(await res.text());
    const articles = items.map((i) => toArticle(i, feed, now)).filter(Boolean).map(tag);
    recordFeed({ feed: feed.id, name: feed.name, country: feed.country, url: feed.url, ok: true, items: items.length });
    return articles;
  } catch (err) {
    const error = err.name === 'TimeoutError' ? 'Timed out' : err.message;
    recordFeed({ feed: feed.id, name: feed.name, country: feed.country, url: feed.url, ok: false, error });
    throw new Error(`${feed.name}: ${error}`);
  }
};

const runPool = async (tasks, limit) => {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await tasks[i]() };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
};

// ── Clustering ───────────────────────────────────────────
const RANK = { Breaking: 2, 'High Priority': 1, Routine: 0 };

const withSource = (a) => {
  const info = sourceInfo(a.source);
  return { ...a, sourceType: info.type, sourceLabel: info.label, sourceNote: info.note };
};

// Fold reports of the same story into one item with relatedSources.
const cluster = (rows) => {
  const leads = [];
  for (const a of rows) {
    const t = tokens(a.headline);
    const match =
      t.size >= 3 && leads.find((l) => l.country === a.country && similarity(l._tokens, t) >= SAME_STORY);
    if (!match) {
      leads.push({ ...a, relatedSources: [], _tokens: t, memberIds: [a.id], settled: a.tagged_at != null });
      continue;
    }
    match.memberIds.push(a.id);
    match.settled = match.settled && a.tagged_at != null;
    // Prefer the publisher's own link over a Google News redirect.
    if (match.origin === 'google' && a.origin !== 'google' && a.source === match.source) {
      Object.assign(match, { id: a.id, url: a.url, summary: a.summary, origin: a.origin });
    } else if (a.source !== match.source && !match.relatedSources.some((r) => r.source === a.source)) {
      match.relatedSources.push(withSource({ source: a.source, url: a.url, headline: a.headline }));
    }
    if (!match.summary && a.summary) match.summary = a.summary;
    if (RANK[a.severity] > RANK[match.severity]) match.severity = a.severity;
  }
  return leads.map(({ _tokens, ...a }) => toApi(a));
};

// Shape used by the front end.
export const toApi = (a) => ({
  ...withSource({ source: a.source }),
  _id: a.id,
  headline: a.headline,
  summary: a.summary || null,
  url: a.url,
  country: a.country,
  category: a.category,
  severity: a.severity,
  publishedTimestamp: new Date(a.published).toISOString(),
  relatedSources: a.relatedSources || [],
  direct: a.origin !== 'google',
  taggedBy: a.taggedBy || (a.llm_category ? 'model' : 'rules'),
  memberIds: a.memberIds || [a.id],
  settled: a.settled ?? a.tagged_at != null,
});

// Rule-based filters, used only for stories the model hasn't tagged.
const rulesSayKeep = (a) =>
  !isOffTopic(a.headline) &&
  !SKIP_SOURCES.test(a.source) &&
  !OFF_TOPIC_PATH.test(a.url) &&
  !(a.origin !== 'google' && isForeignOnly(a.headline));

const modelTagged = (a) => a.llm_relevant != null && a.llm_category;

const rebuildLive = () => {
  const rows = recentArticles(Date.now() - LIVE_WINDOW_MS)
    .filter((a) => (modelTagged(a) ? a.llm_relevant === 1 : rulesSayKeep(a)))
    .map((a) =>
      modelTagged(a)
        ? { ...a, country: a.llm_country, category: a.llm_category, severity: a.llm_severity, taggedBy: 'model' }
        : { ...tag({ ...a, country: resolveCountry(a.headline, a.country) }), taggedBy: 'rules' }
    );
  state.articles = cluster(rows);
  evaluateAlerts(state.articles).catch((err) => console.error('[alerts]', err));
};

export const refresh = async () => {
  const feeds = [...GOOGLE_FEEDS, ...FEEDS];
  const results = await runPool(feeds.map((f) => () => fetchFeed(f)), CONCURRENCY);
  const collected = results.filter((r) => r.ok).flatMap((r) => r.value);
  const failed = results.filter((r) => !r.ok).map((r) => r.error.message);

  // Same URL can arrive via two feeds; keep one.
  const unique = [...new Map(collected.map((a) => [a.id, a])).values()];
  const added = unique.length ? saveArticles(unique) : 0;
  const pruned = pruneOld();
  rebuildLive();

  state.lastRefresh = new Date().toISOString();
  runTagger(rebuildLive).catch((err) => console.error('[tagger]', err));
  state.lastError = failed.length ? failed.join('; ') : null;
  console.log(
    `[feeds] ${feeds.length - failed.length}/${feeds.length} feeds ok, ${unique.length} items, ${added} new` +
      `${pruned ? `, ${pruned} pruned` : ''}; live view ${state.articles.length} stories` +
      (failed.length ? `\n[feeds] failed: ${state.lastError}` : '')
  );
  return state;
};

// Build the live view from the database at startup, before the first fetch.
export const loadFromDb = () => {
  rebuildLive();
  console.log(`[feeds] ${state.articles.length} stories from database`);
};

export const getState = () => state;
