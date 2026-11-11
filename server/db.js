// SQLite storage (Node's built-in node:sqlite, no extra install).
// Keeps every collected report for RETENTION_DAYS so the archive is searchable.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(process.env.DATA_DIR || 'server/.data', 'osint.db');
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 180;

mkdirSync(path.dirname(FILE), { recursive: true });
const db = new DatabaseSync(FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS articles (
    id         TEXT PRIMARY KEY,
    headline   TEXT NOT NULL,
    summary    TEXT,
    body       TEXT,
    source     TEXT NOT NULL,
    url        TEXT NOT NULL,
    country    TEXT NOT NULL,
    category   TEXT NOT NULL,
    severity   TEXT NOT NULL,
    published  INTEGER NOT NULL,
    first_seen INTEGER NOT NULL,
    origin     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published);
  CREATE INDEX IF NOT EXISTS idx_articles_country ON articles(country, published);
  CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);

  CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
    headline, summary, content='articles', content_rowid='rowid'
  );
  CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
    INSERT INTO articles_fts(rowid, headline, summary) VALUES (new.rowid, new.headline, new.summary);
  END;
  CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
    INSERT INTO articles_fts(articles_fts, rowid, headline, summary) VALUES ('delete', old.rowid, old.headline, old.summary);
  END;
  CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE OF headline, summary ON articles BEGIN
    INSERT INTO articles_fts(articles_fts, rowid, headline, summary) VALUES ('delete', old.rowid, old.headline, old.summary);
    INSERT INTO articles_fts(rowid, headline, summary) VALUES (new.rowid, new.headline, new.summary);
  END;

  CREATE TABLE IF NOT EXISTS feed_status (
    feed       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    country    TEXT,
    url        TEXT NOT NULL,
    ok         INTEGER NOT NULL,
    items      INTEGER NOT NULL DEFAULT 0,
    error      TEXT,
    checked_at INTEGER NOT NULL,
    last_ok_at INTEGER
  );
`);

// Columns for model-assigned tags (added after the first release, hence ALTER).
const existing = new Set(db.prepare('PRAGMA table_info(articles)').all().map((c) => c.name));
for (const [col, type] of [
  ['llm_country', 'TEXT'],
  ['llm_category', 'TEXT'],
  ['llm_severity', 'TEXT'],
  ['llm_relevant', 'INTEGER'],
  ['tagged_at', 'INTEGER'],
]) {
  if (!existing.has(col)) db.exec(`ALTER TABLE articles ADD COLUMN ${col} ${type}`);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_articles_untagged ON articles(tagged_at, published)');

// Model tags win over keyword rules; stories the model marked irrelevant are hidden.
const EFFECTIVE = `
  COALESCE(a.llm_country, a.country) AS country,
  COALESCE(a.llm_category, a.category) AS category,
  COALESCE(a.llm_severity, a.severity) AS severity`;
const RELEVANT = '(a.llm_relevant IS NULL OR a.llm_relevant = 1)';

const upsertStmt = db.prepare(`
  INSERT INTO articles (id, headline, summary, source, url, country, category, severity, published, first_seen, origin)
  VALUES (:id, :headline, :summary, :source, :url, :country, :category, :severity, :published, :first_seen, :origin)
  ON CONFLICT(id) DO UPDATE SET
    headline = excluded.headline,
    summary  = COALESCE(excluded.summary, articles.summary),
    country  = excluded.country,
    category = excluded.category,
    severity = excluded.severity
`);

// Returns how many of the given articles were new.
export const saveArticles = (list) => {
  const exists = db.prepare('SELECT 1 FROM articles WHERE id = ?');
  let added = 0;
  db.exec('BEGIN');
  try {
    for (const a of list) {
      if (!exists.get(a.id)) added += 1;
      upsertStmt.run({
        id: a.id,
        headline: a.headline,
        summary: a.summary || null,
        source: a.source,
        url: a.url,
        country: a.country,
        category: a.category,
        severity: a.severity,
        published: a.published,
        first_seen: a.first_seen,
        origin: a.origin,
      });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return added;
};

export const recentArticles = (sinceMs) =>
  db.prepare('SELECT * FROM articles WHERE published >= ? ORDER BY published DESC').all(sinceMs);

export const getArticle = (id) => db.prepare('SELECT * FROM articles WHERE id = ?').get(id);

export const saveBody = (id, body) => db.prepare('UPDATE articles SET body = ? WHERE id = ?').run(body, id);

export const pruneOld = () =>
  db.prepare('DELETE FROM articles WHERE published < ?').run(Date.now() - RETENTION_DAYS * 86400e3).changes;

// Turn free text into a safe FTS5 query: each word as a prefix term, all required.
const ftsQuery = (q) =>
  q
    .replace(/["*():^{}\[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .map((w) => `"${w}"*`)
    .join(' ');

export const searchArticles = ({ q, country, category, severity, source, from, to, limit = 50, offset = 0 }) => {
  const where = [RELEVANT];
  const params = {};
  let join = '';
  const match = q ? ftsQuery(q) : '';
  if (match) {
    join = 'JOIN articles_fts ON articles_fts.rowid = a.rowid';
    where.push('articles_fts MATCH :match');
    params.match = match;
  }
  if (country) { where.push('COALESCE(a.llm_country, a.country) = :country'); params.country = country; }
  if (category) { where.push('COALESCE(a.llm_category, a.category) = :category'); params.category = category; }
  if (severity) { where.push('COALESCE(a.llm_severity, a.severity) = :severity'); params.severity = severity; }
  if (source) { where.push('a.source = :source'); params.source = source; }
  if (from) { where.push('a.published >= :from'); params.from = from; }
  if (to) { where.push('a.published <= :to'); params.to = to; }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS n FROM articles a ${join} ${clause}`).get(params).n;
  const rows = db
    .prepare(
      `SELECT a.id, a.headline, a.summary, a.source, a.url, a.origin, a.published, ${EFFECTIVE}
       FROM articles a ${join} ${clause} ORDER BY a.published DESC LIMIT :limit OFFSET :offset`
    )
    .all({ ...params, limit, offset });
  return { total, rows };
};

// Reports per day per country over the last `days` days (UTC days).
export const dailyCounts = (days) =>
  db
    .prepare(
      `SELECT date(a.published / 1000, 'unixepoch') AS day, COALESCE(a.llm_country, a.country) AS country, COUNT(*) AS n
       FROM articles a WHERE a.published >= ? AND ${RELEVANT} GROUP BY day, 2 ORDER BY day`
    )
    .all(Date.now() - days * 86400e3);

export const categoryCounts = (days) =>
  db
    .prepare(
      `SELECT COALESCE(a.llm_country, a.country) AS country, COALESCE(a.llm_category, a.category) AS category,
              COUNT(*) AS n
       FROM articles a WHERE a.published >= ? AND ${RELEVANT} GROUP BY 1, 2`
    )
    .all(Date.now() - days * 86400e3);

export const sourceStats = (days) =>
  db
    .prepare(
      `SELECT a.source, COUNT(*) AS n, MAX(a.published) AS last_seen,
              GROUP_CONCAT(DISTINCT COALESCE(a.llm_country, a.country)) AS countries,
              SUM(CASE WHEN a.origin = 'google' THEN 0 ELSE 1 END) AS direct
       FROM articles a WHERE a.published >= ? AND ${RELEVANT} GROUP BY a.source ORDER BY n DESC`
    )
    .all(Date.now() - days * 86400e3);

export const recordFeed = ({ feed, name, country, url, ok, items, error }) => {
  const now = Date.now();
  db.prepare(
    `INSERT INTO feed_status (feed, name, country, url, ok, items, error, checked_at, last_ok_at)
     VALUES (:feed, :name, :country, :url, :ok, :items, :error, :now, CASE WHEN :ok = 1 THEN :now END)
     ON CONFLICT(feed) DO UPDATE SET
       name = excluded.name, country = excluded.country, url = excluded.url, ok = excluded.ok,
       items = excluded.items, error = excluded.error, checked_at = excluded.checked_at,
       last_ok_at = COALESCE(excluded.last_ok_at, feed_status.last_ok_at)`
  ).run({ feed, name, country: country ?? null, url, ok: ok ? 1 : 0, items: items || 0, error: error || null, now });
};

export const feedStatuses = () => db.prepare('SELECT * FROM feed_status ORDER BY country, name').all();

export const totals = () =>
  // `oldest` is when collection started (first time we saw anything), not the oldest publish date.
  db.prepare('SELECT COUNT(*) AS n, MIN(first_seen) AS oldest FROM articles').get();

// ── Model tagging ────────────────────────────────────────
export const untaggedArticles = (sinceMs, limit) =>
  db
    .prepare(
      `SELECT id, headline, summary, source, country FROM articles
       WHERE tagged_at IS NULL AND published >= ? ORDER BY published DESC LIMIT ?`
    )
    .all(sinceMs, limit);

export const saveTags = (tags) => {
  const stmt = db.prepare(
    `UPDATE articles SET llm_country = :country, llm_category = :category, llm_severity = :severity,
            llm_relevant = :relevant, tagged_at = :now WHERE id = :id`
  );
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (const t of tags) stmt.run({ ...t, relevant: t.relevant == null ? null : t.relevant ? 1 : 0, now });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

export const tagStats = (sinceMs) =>
  db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN tagged_at IS NOT NULL THEN 1 ELSE 0 END) AS tagged,
              SUM(CASE WHEN llm_relevant = 0 THEN 1 ELSE 0 END) AS hidden
       FROM articles WHERE published >= ?`
    )
    .get(sinceMs);

// ── Watchlist & alerts ───────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS watch_rules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    terms        TEXT NOT NULL,              -- JSON array of phrases, any may match
    countries    TEXT NOT NULL DEFAULT '[]', -- JSON array; empty = any country
    min_severity TEXT NOT NULL DEFAULT 'Routine',
    telegram     INTEGER NOT NULL DEFAULT 0,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id     INTEGER NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE,
    article_id  TEXT NOT NULL,
    story_key   TEXT NOT NULL,                -- all report ids of the story, for dedupe
    matched     TEXT NOT NULL,                -- the term that matched
    created_at  INTEGER NOT NULL,
    read_at     INTEGER,
    notified_at INTEGER,
    UNIQUE (rule_id, article_id)
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(read_at, created_at);
`);
db.exec('PRAGMA foreign_keys = ON');

const ruleFromRow = (r) => ({
  id: r.id,
  name: r.name,
  terms: JSON.parse(r.terms),
  countries: JSON.parse(r.countries),
  minSeverity: r.min_severity,
  telegram: Boolean(r.telegram),
  enabled: Boolean(r.enabled),
  createdAt: new Date(r.created_at).toISOString(),
  alertCount: r.alert_count ?? 0,
  unread: r.unread ?? 0,
});

export const listRules = () =>
  db
    .prepare(
      `SELECT r.*, COUNT(a.id) AS alert_count, SUM(CASE WHEN a.id IS NOT NULL AND a.read_at IS NULL THEN 1 ELSE 0 END) AS unread
       FROM watch_rules r LEFT JOIN alerts a ON a.rule_id = r.id GROUP BY r.id ORDER BY r.created_at`
    )
    .all()
    .map(ruleFromRow);

export const createRule = ({ name, terms, countries, minSeverity, telegram }) => {
  const info = db
    .prepare(
      `INSERT INTO watch_rules (name, terms, countries, min_severity, telegram, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name, JSON.stringify(terms), JSON.stringify(countries), minSeverity, telegram ? 1 : 0, Date.now());
  return Number(info.lastInsertRowid);
};

export const updateRule = (id, changes) => {
  const cols = { name: 'name', minSeverity: 'min_severity', enabled: 'enabled', telegram: 'telegram' };
  const sets = [];
  const params = { id };
  for (const [key, col] of Object.entries(cols)) {
    if (changes[key] === undefined) continue;
    sets.push(`${col} = :${key}`);
    params[key] = typeof changes[key] === 'boolean' ? (changes[key] ? 1 : 0) : changes[key];
  }
  for (const key of ['terms', 'countries']) {
    if (changes[key] === undefined) continue;
    sets.push(`${key} = :${key}`);
    params[key] = JSON.stringify(changes[key]);
  }
  if (!sets.length) return 0;
  return db.prepare(`UPDATE watch_rules SET ${sets.join(', ')} WHERE id = :id`).run(params).changes;
};

export const deleteRule = (id) => db.prepare('DELETE FROM watch_rules WHERE id = ?').run(id).changes;

export const enabledRules = () =>
  db.prepare('SELECT * FROM watch_rules WHERE enabled = 1').all().map(ruleFromRow);

// Story keys already alerted for a rule (to skip other reports of the same story).
export const alertedKeys = (ruleId, sinceMs) =>
  db.prepare('SELECT story_key FROM alerts WHERE rule_id = ? AND created_at >= ?').all(ruleId, sinceMs).map((r) => r.story_key);

export const insertAlert = ({ ruleId, articleId, storyKey, matched }) =>
  db
    .prepare(
      `INSERT OR IGNORE INTO alerts (rule_id, article_id, story_key, matched, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(ruleId, articleId, storyKey, matched, Date.now()).changes > 0;

export const markNotified = (ids) => {
  const stmt = db.prepare('UPDATE alerts SET notified_at = ? WHERE id = ?');
  const now = Date.now();
  for (const id of ids) stmt.run(now, id);
};

export const listAlerts = ({ unreadOnly = false, ruleId, limit = 100 } = {}) =>
  db
    .prepare(
      `SELECT al.id, al.rule_id, al.matched, al.created_at, al.read_at, r.name AS rule_name,
              a.id AS article_id, a.headline, a.summary, a.source, a.url, a.origin, a.published,
              COALESCE(a.llm_country, a.country) AS country,
              COALESCE(a.llm_category, a.category) AS category,
              COALESCE(a.llm_severity, a.severity) AS severity
       FROM alerts al
       JOIN watch_rules r ON r.id = al.rule_id
       JOIN articles a ON a.id = al.article_id
       WHERE (:unread = 0 OR al.read_at IS NULL) AND (:rule IS NULL OR al.rule_id = :rule)
       ORDER BY al.created_at DESC, a.published DESC LIMIT :limit`
    )
    .all({ unread: unreadOnly ? 1 : 0, rule: ruleId ?? null, limit });

export const unreadAlertCount = () => db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE read_at IS NULL').get().n;

export const markAlertsRead = (ids) => {
  const now = Date.now();
  if (ids === 'all') return db.prepare('UPDATE alerts SET read_at = ? WHERE read_at IS NULL').run(now).changes;
  const stmt = db.prepare('UPDATE alerts SET read_at = ? WHERE id = ? AND read_at IS NULL');
  return ids.reduce((n, id) => n + stmt.run(now, id).changes, 0);
};

export const pendingNotifications = (ids) =>
  ids.length
    ? db
        .prepare(
          `SELECT al.id, al.matched, r.name AS rule_name, r.telegram, a.headline, a.source, a.url,
                  COALESCE(a.llm_country, a.country) AS country, COALESCE(a.llm_severity, a.severity) AS severity
           FROM alerts al JOIN watch_rules r ON r.id = al.rule_id JOIN articles a ON a.id = al.article_id
           WHERE al.id IN (${ids.map(() => '?').join(',')}) AND al.notified_at IS NULL`
        )
        .all(...ids)
    : [];

export const alertIdsFor = (ruleId, articleIds) =>
  articleIds.length
    ? db
        .prepare(`SELECT id FROM alerts WHERE rule_id = ? AND article_id IN (${articleIds.map(() => '?').join(',')})`)
        .all(ruleId, ...articleIds)
        .map((r) => r.id)
    : [];

export const newestAlertId = () => db.prepare('SELECT MAX(id) AS id FROM alerts').get().id || 0;
