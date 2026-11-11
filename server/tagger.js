// Tags stories with a language model (Groq): country, category, priority and
// whether the story belongs in the feed at all. Keyword rules (classify.js)
// remain the fallback for anything not yet tagged or when no key is set.
//
// Runs as a background worker: processes untagged stories newest-first in
// batches, pacing itself to Groq's per-minute token limit.

import { groqJson } from './veritas.js';
import { untaggedArticles, saveTags, tagStats } from './db.js';

const MODEL = process.env.TAG_MODEL || 'openai/gpt-oss-20b';
const BATCH = Number(process.env.TAG_BATCH) || 40;
const TOKENS_PER_MIN = Number(process.env.TAG_TOKENS_PER_MIN) || 8000;
const DAILY_LIMIT = Number(process.env.TAG_DAILY_REQUESTS) || 800; // Groq free tier: 1000/day
const WINDOW_MS = 48 * 3600 * 1000; // only tag stories still in the live view

const COUNTRY = { PK: 'Pakistan', CN: 'China', BD: 'Bangladesh', MM: 'Myanmar', NP: 'Nepal', BT: 'Bhutan', AF: 'Afghanistan' };
const CATEGORY = {
  MIL: 'Military & Defense',
  SEC: 'Security and Conflicts',
  FOR: 'Foreign Policy',
  ECO: 'Economics and Trade',
  INF: 'Infrastructure',
  INT: 'Internal Affairs',
};
const SEVERITY = { B: 'Breaking', H: 'High Priority', R: 'Routine' };

const SYSTEM = `You tag news stories for an intelligence dashboard that tracks India's neighbours:
Pakistan (PK), China (CN), Bangladesh (BD), Myanmar (MM), Nepal (NP), Bhutan (BT), Afghanistan (AF).

For each numbered story return:
- "c": the ONE country above that is a main actor or subject of the story. That includes its
  government, leaders, parties, armed forces and armed groups: the Taliban are Afghanistan's rulers
  (AF), the TTP and Baloch groups are PK, the Arakan Army and other ethnic armed groups are MM.
  A story about another power's policy towards one of them (e.g. "Russia's Taliban strategy",
  "US presses China on exports") counts for that country. Use "XX" only if none of the seven is a
  main actor or subject (e.g. a story about Iran, Bulgaria or US universities). When several
  countries are involved and one of them is among the seven (e.g. "Russia, China and US hold
  talks", "IEA says China's solar industry is losing money"), use that one, not "XX".
- "rel": 1 if it belongs on the dashboard, 0 if not. Relevant: politics, security, economy,
  diplomacy (including climate talks), infrastructure, disasters, climate and environment policy,
  public health, migration and refugees, human rights. Not relevant (0): sport, entertainment,
  celebrities, lifestyle, festivals and culture features, horoscopes, routine company announcements
  (branch openings, product launches, awards), and anything with c = "XX".
- "cat": MIL (military, defence, armed forces, weapons), SEC (attacks, militancy, insurgency, armed
  clashes, terrorism, crime with security impact, unrest, arrests in crackdowns), FOR (diplomacy,
  foreign relations, treaties, international visits and summits, climate negotiations), ECO
  (economy, trade, banking, finance, budgets, loans, markets), INF (physical infrastructure:
  ports, roads, rail, power, dams, telecom networks, big construction projects), INT (domestic
  politics, courts, elections, governance, society, environment at home).
- "sev": B (breaking: a sudden major event of national significance, e.g. a deadly militant attack,
  coup, major disaster, head of government falls, armed clash between states. Ordinary crime,
  individual incidents, statements, quotes and analysis are never B), H (high: significant security or military news,
  elections, major protests, sanctions, and ANY story in which India is involved or India's
  borders (LAC, LoC, Kashmir, Arunachal, Ladakh, north-east) are concerned), R (routine:
  everything else). Ordinary diplomacy, climate talks, economic figures and business news are R
  unless they involve India or a major shift. Opinion pieces and explainers are at most H.
  Keep H for what an India-focused analyst must not miss; most stories are R.

Reply with JSON only: {"items":[{"i":1,"c":"PK","rel":1,"cat":"SEC","sev":"B"}, ...]} covering every story.`;

const state = {
  running: false,
  requestsToday: 0,
  day: new Date().toDateString(),
  lastError: null,
  lastRun: null,
};

export const isEnabled = () => Boolean(process.env.GROQ_API_KEY) && process.env.TAG_WITH_LLM !== 'off';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const formatBatch = (rows) =>
  rows
    .map((r, i) => {
      const dek = r.summary ? ` | ${r.summary.slice(0, 160)}` : '';
      return `${i + 1}. ${r.headline}${dek} [${r.source}]`;
    })
    .join('\n');

// The model sometimes leaves stories out of its reply. Those stay pending and
// are retried in the next batch; after MAX_TRIES the rules take over.
const MAX_TRIES = 3;
const tries = new Map();

// Turn the model's reply into rows for saveTags; `null` means "retry later".
const parseTags = (rows, json) => {
  const byIndex = new Map();
  for (const item of Array.isArray(json?.items) ? json.items : []) {
    const i = Number(item?.i);
    if (Number.isInteger(i) && i >= 1 && i <= rows.length) byIndex.set(i, item);
  }
  return rows.map((row, idx) => {
    const t = byIndex.get(idx + 1);
    const country = COUNTRY[t?.c];
    const category = CATEGORY[t?.cat];
    const severity = SEVERITY[t?.sev];
    const xx = t?.c === 'XX';
    if (xx) {
      tries.delete(row.id);
      return { id: row.id, country: null, category: category || null, severity: severity || null, relevant: false };
    }
    if (!t || !country || !category || !severity) {
      const n = (tries.get(row.id) || 0) + 1;
      tries.set(row.id, n);
      if (n < MAX_TRIES) return null;
      tries.delete(row.id);
      return { id: row.id, country: null, category: null, severity: null, relevant: null }; // rules apply
    }
    tries.delete(row.id);
    return { id: row.id, country, category, severity, relevant: Boolean(Number(t.rel)) };
  }).filter(Boolean);
};

export const tagBatch = async (rows) => {
  const { json, usage } = await groqJson({
    model: MODEL,
    system: SYSTEM,
    user: formatBatch(rows),
    maxTokens: 4000,
  });
  return { tags: parseTags(rows, json), tokens: usage?.total_tokens || 0 };
};

// Process the backlog; `onProgress` lets the live feed refresh after each batch.
export const runTagger = async (onProgress = () => {}) => {
  if (!isEnabled() || state.running) return;
  state.running = true;
  try {
    for (;;) {
      if (state.day !== new Date().toDateString()) {
        state.day = new Date().toDateString();
        state.requestsToday = 0;
      }
      if (state.requestsToday >= DAILY_LIMIT) {
        state.lastError = `Daily limit of ${DAILY_LIMIT} tagging requests reached; rules apply until tomorrow.`;
        break;
      }
      const rows = untaggedArticles(Date.now() - WINDOW_MS, BATCH);
      if (!rows.length) break;

      let result;
      try {
        state.requestsToday += 1;
        result = await tagBatch(rows);
      } catch (err) {
        state.lastError = err.message;
        console.warn('[tagger]', err.message);
        if (err.status === 429 && err.retryAfter && err.retryAfter <= 60) {
          await sleep(err.retryAfter * 1000 + 500);
          continue;
        }
        break; // auth/model/network problem: try again on the next refresh
      }

      saveTags(result.tags);
      state.lastError = null;
      state.lastRun = new Date().toISOString();
      const kept = result.tags.filter((t) => t.relevant === true).length;
      const hidden = result.tags.filter((t) => t.relevant === false).length;
      const retry = rows.length - result.tags.length;
      console.log(
        `[tagger] ${result.tags.length}/${rows.length} tagged (${kept} kept, ${hidden} hidden` +
          `${retry ? `, ${retry} left for retry` : ''}), ${result.tokens} tokens`
      );
      if (result.tags.length === 0) break; // nothing usable came back; try again next refresh
      onProgress();

      // Stay under the per-minute token limit before the next batch.
      await sleep(Math.ceil((result.tokens / TOKENS_PER_MIN) * 60000) + 1000);
    }
  } finally {
    state.running = false;
  }
};

export const taggerStatus = () => {
  const s = tagStats(Date.now() - WINDOW_MS);
  return {
    enabled: isEnabled(),
    model: isEnabled() ? MODEL : null,
    running: state.running,
    tagged: s.tagged || 0,
    pending: (s.total || 0) - (s.tagged || 0),
    hidden: s.hidden || 0,
    requestsToday: state.requestsToday,
    lastRun: state.lastRun,
    lastError: state.lastError,
  };
};
