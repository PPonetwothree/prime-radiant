// API server for the OSINT dashboard. Also serves the built front end from dist/.
//   npm start            -> production (build first with `npm run build`)
//   npm run dev:api      -> API only, restarts on change

import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { COUNTRIES, refresh, loadFromDb, getState, toApi } from './feeds.js';
import { generate, formatHeadlines, VeritasError, isConfigured, providerLabel, contextBudget } from './veritas.js';
import { searchArticles, dailyCounts, categoryCounts, sourceStats, feedStatuses, getArticle, totals } from './db.js';
import { sourceInfo, TYPE_LABELS } from './sources.js';
import { articleText } from './extract.js';
import { taggerStatus } from './tagger.js';
import { evaluateAlerts, telegramConfigured, sendTestTelegram } from './alerts.js';
import {
  listRules, createRule, updateRule, deleteRule, listAlerts, unreadAlertCount, markAlertsRead, newestAlertId,
} from './db.js';

const PORT = Number(process.env.PORT) || 5000;
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES) || 10;
const DIST = path.resolve('dist');

const TIME_WINDOWS = {
  '2min': 2 * 60e3,
  '15min': 15 * 60e3,
  '1hour': 3600e3,
  '6hours': 6 * 3600e3,
  '24hours': 24 * 3600e3,
  '48hours': 48 * 3600e3,
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Allow a separately hosted front end (e.g. Vite dev server) to call the API.
const ALLOWED = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim());
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED.includes('*') || ALLOWED.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const clampInt = (v, min, max, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
};
const pick = (v) => (typeof v === 'string' && v && v !== 'all' ? v : undefined);

const filterArticles = ({ timeFilter, country, category, severity, countries, categories } = {}) => {
  const windowMs = TIME_WINDOWS[timeFilter] ?? TIME_WINDOWS['24hours'];
  const since = Date.now() - windowMs;
  return getState().articles.filter(
    (a) =>
      new Date(a.publishedTimestamp).getTime() >= since &&
      (!country || country === 'all' || a.country === country) &&
      (!category || category === 'all' || a.category === category) &&
      (!severity || severity === 'all' || a.severity === severity) &&
      (!countries?.length || countries.includes(a.country)) &&
      (!categories?.length || categories.includes(a.category))
  );
};

// ── Live feed ────────────────────────────────────────────
const articles = express.Router();

articles.get('/', (req, res) => {
  const { timeFilter, country, category, severity } = req.query;
  if (pick(country) && !COUNTRIES.includes(country)) {
    return res.status(400).json({ success: false, error: 'Unknown country' });
  }
  const limit = clampInt(req.query.limit, 1, 500, 200);
  const list = filterArticles({ timeFilter, country, category, severity });
  res.json({ success: true, count: list.length, lastRefresh: getState().lastRefresh, data: list.slice(0, limit) });
});

articles.get('/breaking/latest', (_req, res) => {
  res.json({ success: true, data: filterArticles({ timeFilter: '6hours', severity: 'Breaking' }).slice(0, 10) });
});

articles.get('/stats/overview', (_req, res) => {
  const list = filterArticles({ timeFilter: '24hours' });
  const tally = (key) => list.reduce((acc, a) => ({ ...acc, [a[key]]: (acc[a[key]] || 0) + 1 }), {});
  const { lastRefresh, lastError } = getState();
  res.json({
    success: true,
    data: {
      total: list.length,
      byCountry: tally('country'),
      byCategory: tally('category'),
      bySeverity: tally('severity'),
      lastRefresh,
      lastError,
    },
  });
});

const outletList = (days) =>
  sourceStats(days).map((s) => ({
    source: s.source,
    count: s.n,
    direct: s.direct > 0,
    lastSeen: new Date(s.last_seen).toISOString(),
    countries: (s.countries || '').split(',').filter(Boolean),
    ...sourceInfo(s.source),
  }));

articles.get('/meta/sources', (_req, res) => res.json({ success: true, data: outletList(30) }));

articles.get('/:id', (req, res) => {
  const live = getState().articles.find((a) => a._id === req.params.id);
  const row = live ? null : getArticle(req.params.id);
  if (!live && !row) return res.status(404).json({ success: false, error: 'Article not found' });
  res.json({ success: true, data: live || toApi(row) });
});

app.use('/api/articles', articles);

// ── Archive, trends, sources ─────────────────────────────
app.get('/api/archive', (req, res) => {
  const days = clampInt(req.query.days, 1, 3650, 30);
  const page = clampInt(req.query.page, 1, 1000, 1);
  const limit = 50;
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
  try {
    const { total, rows } = searchArticles({
      q,
      country: pick(req.query.country),
      category: pick(req.query.category),
      severity: pick(req.query.severity),
      source: pick(req.query.source),
      from: Date.now() - days * 86400e3,
      limit,
      offset: (page - 1) * limit,
    });
    res.json({ success: true, total, page, pages: Math.ceil(total / limit), data: rows.map(toApi) });
  } catch (err) {
    res.status(400).json({ success: false, error: 'Could not run that search.' });
  }
});

app.get('/api/trends', (req, res) => {
  const days = clampInt(req.query.days, 1, 90, 14);
  const dates = Array.from({ length: days }, (_, i) =>
    new Date(Date.now() - (days - 1 - i) * 86400e3).toISOString().slice(0, 10)
  );
  const series = Object.fromEntries(COUNTRIES.map((c) => [c, dates.map(() => 0)]));
  for (const { day, country, n } of dailyCounts(days)) {
    const i = dates.indexOf(day);
    if (i >= 0 && series[country]) series[country][i] = n;
  }
  const categories = Object.fromEntries(COUNTRIES.map((c) => [c, {}]));
  for (const { country, category, n } of categoryCounts(days)) {
    if (categories[country]) categories[country][category] = n;
  }
  const { n, oldest } = totals();
  res.json({
    success: true,
    data: { dates, series, categories, stored: n, since: oldest ? new Date(oldest).toISOString() : null },
  });
});

app.get('/api/sources', (_req, res) => {
  const feeds = feedStatuses().map((f) => ({
    id: f.feed,
    name: f.name,
    country: f.country,
    ok: Boolean(f.ok),
    items: f.items,
    error: f.error,
    checkedAt: new Date(f.checked_at).toISOString(),
    lastOkAt: f.last_ok_at ? new Date(f.last_ok_at).toISOString() : null,
  }));
  res.json({ success: true, data: { types: TYPE_LABELS, outlets: outletList(30), feeds } });
});

// ── Watchlist & alerts ───────────────────────────────────
const SEVERITIES = ['Routine', 'High Priority', 'Breaking'];

// Validate rule input; returns [error, clean].
const cleanRule = (body, partial = false) => {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = str(body.name, 60);
    if (!name) return ['Give the rule a name.'];
    out.name = name;
  }
  if (!partial || body.terms !== undefined) {
    const raw = Array.isArray(body.terms) ? body.terms : String(body.terms || '').split(/[\n,]/);
    const terms = [...new Set(raw.map((t) => str(t, 60)).filter((t) => t.replace('*', '').length >= 2))].slice(0, 30);
    if (!terms.length) return ['Add at least one word or phrase to watch for.'];
    out.terms = terms;
  }
  if (!partial || body.countries !== undefined) {
    out.countries = (Array.isArray(body.countries) ? body.countries : []).filter((c) => COUNTRIES.includes(c));
  }
  if (!partial || body.minSeverity !== undefined) {
    out.minSeverity = SEVERITIES.includes(body.minSeverity) ? body.minSeverity : 'Routine';
  }
  if (body.telegram !== undefined) out.telegram = Boolean(body.telegram);
  if (partial && body.enabled !== undefined) out.enabled = Boolean(body.enabled);
  return [null, out];
};

const rematch = () => evaluateAlerts(getState().articles).catch((err) => console.error('[alerts]', err));

app.get('/api/watchlist', (_req, res) => {
  res.json({ success: true, data: { rules: listRules(), telegram: telegramConfigured() } });
});

app.post('/api/watchlist', async (req, res) => {
  const [error, rule] = cleanRule(req.body || {});
  if (error) return res.status(400).json({ success: false, error });
  if (listRules().length >= 50) return res.status(400).json({ success: false, error: 'Up to 50 rules.' });
  const id = createRule(rule);
  await rematch(); // show matches from the last 48 hours straight away
  res.status(201).json({ success: true, data: listRules().find((r) => r.id === id) });
});

app.patch('/api/watchlist/:id', async (req, res) => {
  const [error, changes] = cleanRule(req.body || {}, true);
  if (error) return res.status(400).json({ success: false, error });
  if (!updateRule(Number(req.params.id), changes)) return res.status(404).json({ success: false, error: 'Rule not found' });
  await rematch();
  res.json({ success: true, data: listRules().find((r) => r.id === Number(req.params.id)) });
});

app.delete('/api/watchlist/:id', (req, res) => {
  if (!deleteRule(Number(req.params.id))) return res.status(404).json({ success: false, error: 'Rule not found' });
  res.json({ success: true });
});

app.post('/api/watchlist/telegram-test', async (_req, res) => {
  if (!telegramConfigured()) {
    return res.status(400).json({ success: false, error: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env first.' });
  }
  try {
    await sendTestTelegram();
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ success: false, error: `Telegram: ${err.message}` });
  }
});

const alertToApi = (r) => ({
  id: r.id,
  ruleId: r.rule_id,
  ruleName: r.rule_name,
  matched: r.matched,
  createdAt: new Date(r.created_at).toISOString(),
  read: r.read_at != null,
  article: toApi({ ...r, id: r.article_id }),
});

app.get('/api/alerts', (req, res) => {
  const rows = listAlerts({
    unreadOnly: req.query.unread === '1',
    ruleId: req.query.rule ? Number(req.query.rule) : undefined,
    limit: clampInt(req.query.limit, 1, 300, 100),
  });
  res.json({ success: true, unread: unreadAlertCount(), data: rows.map(alertToApi) });
});

// Cheap endpoint the page polls for the nav badge and desktop notifications.
app.get('/api/alerts/count', (_req, res) => {
  const latest = listAlerts({ unreadOnly: true, limit: 1 })[0];
  res.json({
    success: true,
    unread: unreadAlertCount(),
    newestId: newestAlertId(),
    latest: latest ? { id: latest.id, headline: latest.headline, rule: latest.rule_name, severity: latest.severity } : null,
  });
});

app.post('/api/alerts/read', (req, res) => {
  const { ids, all } = req.body || {};
  const changed = all ? markAlertsRead('all') : markAlertsRead((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean));
  res.json({ success: true, changed, unread: unreadAlertCount() });
});

// ── Veritas ──────────────────────────────────────────────
const veritas = express.Router();

// Basic per-IP limit so a public deployment can't drain the Gemini quota.
const hits = new Map();
const LIMIT_PER_MIN = Number(process.env.VERITAS_PER_MINUTE) || 10;
veritas.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60e3);
  if (recent.length >= LIMIT_PER_MIN) {
    return res.status(429).json({ success: false, error: 'Too many questions. Wait a minute and try again.' });
  }
  recent.push(now);
  hits.set(req.ip, recent);
  next();
});

const answer = (handler) => async (req, res) => {
  try {
    const response = await handler(req.body || {});
    res.json({ success: true, response });
  } catch (err) {
    const status = err instanceof VeritasError ? err.status : 500;
    if (!(err instanceof VeritasError)) console.error('[veritas]', err);
    res.status(status).json({ success: false, error: err.message || 'Veritas failed' });
  }
};

const str = (v, max = 1000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

veritas.get('/suggestions', (_req, res) => {
  const top = filterArticles({ timeFilter: '24hours' }).filter((a) => a.severity !== 'Routine').slice(0, 2);
  const suggestions = [
    ...top.map((a) => `What is the significance of: "${a.headline}"?`),
    'What are the latest developments on the China-India border?',
    "Summarise Pakistan's security situation this week",
    'Connect recent events across South Asian countries',
    'What economic news from the region matters most for India?',
  ].slice(0, 5);
  res.json({ success: true, suggestions, configured: isConfigured(), model: providerLabel() });
});

veritas.post(
  '/ask',
  answer(async ({ question, conversationHistory }) => {
    const q = str(question, 2000);
    if (!q) throw new VeritasError('Question is empty.', 400);
    const mentioned = COUNTRIES.filter((c) => q.toLowerCase().includes(c.toLowerCase()));
    const context = filterArticles({ timeFilter: '48hours', countries: mentioned }).slice(0, 60);
    const history = Array.isArray(conversationHistory) ? conversationHistory : [];
    return generate(`Recent reports:\n${formatHeadlines(context) || '(none)'}\n\nQuestion: ${q}`, history);
  })
);

veritas.post(
  '/tldr',
  answer(async ({ articleId }) => {
    const id = str(articleId, 40);
    const live = getState().articles.find((a) => a._id === id);
    const row = live || (getArticle(id) && toApi(getArticle(id)));
    if (!row) throw new VeritasError('That article is no longer stored.', 404);
    const versions = [row, ...row.relatedSources.map((r) => ({ ...row, ...r, summary: null, relatedSources: [] }))];
    // Leave room for the headlines within the provider's budget.
    const body = (await articleText(id))?.slice(0, Math.floor(contextBudget() * 0.6));
    return generate(
      `Reports of one story:\n${formatHeadlines(versions)}\n\n` +
        (body ? `Full text of the first report (${row.source}):\n${body}\n\n` : '') +
        'Give a TL;DR in at most three sentences, then one line on why it matters to India. ' +
        (body ? 'Base it on the full text.' : 'Say that this is based on headlines only.')
    );
  })
);

veritas.post(
  '/analyze-impact',
  answer(async ({ sourceCountry, targetCountry }) => {
    const from = str(sourceCountry, 60);
    const to = str(targetCountry, 60) || 'India';
    if (!COUNTRIES.includes(from)) throw new VeritasError('Unknown source country.', 400);
    const context = filterArticles({ timeFilter: '48hours', country: from }).slice(0, 50);
    return generate(
      `Recent reports about ${from}:\n${formatHeadlines(context) || '(none)'}\n\n` +
        `Analyse how these developments in ${from} could affect ${to}: security, economy and diplomacy. ` +
        'Rank the three most consequential items.'
    );
  })
);

veritas.post(
  '/connect-events',
  answer(async ({ countries, categories, timeframe }) => {
    const cs = Array.isArray(countries) ? countries.filter((c) => COUNTRIES.includes(c)) : [];
    const cats = Array.isArray(categories) ? categories.map((c) => str(c, 60)).filter(Boolean) : [];
    const context = filterArticles({
      timeFilter: TIME_WINDOWS[timeframe] ? timeframe : '24hours',
      countries: cs,
      categories: cats,
    }).slice(0, 70);
    return generate(
      `Reports:\n${formatHeadlines(context, { summaries: false }) || '(none)'}\n\n` +
        'Identify links between these events across countries: shared actors, causes or likely knock-on effects. ' +
        'Only claim a connection the reports support; flag speculation as such.'
    );
  })
);

app.use('/api/veritas', veritas);

app.get('/api/health', (_req, res) => {
  const { articles: list, lastRefresh, lastError } = getState();
  const feeds = feedStatuses();
  res.json({
    ok: true,
    stories: list.length,
    stored: totals().n,
    feedsOk: feeds.filter((f) => f.ok).length,
    feedsTotal: feeds.length,
    lastRefresh,
    lastError,
    veritas: providerLabel(),
    tagging: taggerStatus(),
  });
});

app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// ── Front end ────────────────────────────────────────────
if (existsSync(DIST)) {
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  // Single-page app: unknown paths get index.html so /veritas etc. work on reload.
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// ── Start ────────────────────────────────────────────────
loadFromDb();
app.listen(PORT, () => {
  console.log(`OSINT server on http://localhost:${PORT}  (Veritas: ${providerLabel() || 'disabled, no API key'})`);
});
refresh().catch((err) => console.error('[feeds]', err));
setInterval(() => refresh().catch((err) => console.error('[feeds]', err)), REFRESH_MINUTES * 60e3);
