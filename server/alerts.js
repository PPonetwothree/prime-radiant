// Watchlist matching: checks the live (clustered, tagged) stories against the
// user's rules and records alerts. Optionally pushes new ones to Telegram.

import { enabledRules, alertedKeys, insertAlert, alertIdsFor, pendingNotifications, markNotified } from './db.js';
import { isEnabled as taggerEnabled } from './tagger.js';

const RANK = { Routine: 0, 'High Priority': 1, Breaking: 2 };
const PUSH_WINDOW_MS = 6 * 3600 * 1000; // only push stories published in the last 6 hours
const DEDUPE_WINDOW_MS = 7 * 86400 * 1000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "LAC" matches the word LAC (not "lack"); "militant*" also matches "militants".
export const termRegex = (term) => {
  const t = term.trim();
  const prefix = t.endsWith('*');
  const body = escapeRe(prefix ? t.slice(0, -1) : t).replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${body}${prefix ? '' : '(?![\\p{L}\\p{N}])'}`, 'iu');
};

const matchTerm = (rule, text) => rule.terms.find((t) => t.trim() && termRegex(t).test(text)) || null;

// A story's tags are final once the model has tagged it (or when tagging is off),
// so alerts don't fire on a keyword-rule guess the model later overturns.
const settled = (a) => !taggerEnabled() || a.settled;

export const evaluateAlerts = async (stories) => {
  const rules = enabledRules();
  if (!rules.length) return { created: 0 };

  let created = 0;
  const toPush = [];
  for (const rule of rules) {
    const seen = new Set(alertedKeys(rule.id, Date.now() - DEDUPE_WINDOW_MS).flatMap((k) => k.split(',')));
    const ruleCreated = new Date(rule.createdAt).getTime();
    for (const s of stories) {
      if (!settled(s)) continue;
      if (RANK[s.severity] < RANK[rule.minSeverity]) continue;
      if (rule.countries.length && !rule.countries.includes(s.country)) continue;
      const members = s.memberIds?.length ? s.memberIds : [s._id];
      if (members.some((id) => seen.has(id))) continue; // already alerted for this story

      const matched = matchTerm(rule, `${s.headline}\n${s.summary || ''}`);
      if (!matched) continue;

      if (insertAlert({ ruleId: rule.id, articleId: s._id, storyKey: members.join(','), matched })) {
        created += 1;
        members.forEach((id) => seen.add(id));
        const published = new Date(s.publishedTimestamp).getTime();
        // Push only fresh stories that appeared after the rule was made.
        if (rule.telegram && published >= ruleCreated && Date.now() - published <= PUSH_WINDOW_MS) {
          toPush.push(...alertIdsFor(rule.id, [s._id]));
        }
      }
    }
  }

  if (created) console.log(`[alerts] ${created} new alert${created === 1 ? '' : 's'}`);
  if (toPush.length && telegramConfigured()) {
    await pushTelegram(pendingNotifications(toPush)).catch((err) => console.warn('[alerts] Telegram:', err.message));
  }
  return { created };
};

// ── Telegram (optional) ──────────────────────────────────
export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

const html = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const sendTelegram = async (text) => {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `HTTP ${res.status}`);
};

// One message per batch (max 10 stories) so a busy hour doesn't become 30 pings.
const pushTelegram = async (rows) => {
  if (!rows.length) return;
  const shown = rows.slice(0, 10);
  const lines = shown.map(
    (r) =>
      `<b>${html(r.severity)} · ${html(r.country)}</b>\n${html(r.headline)} (${html(r.source)})\n` +
      `<i>${html(r.rule_name)}: “${html(r.matched)}”</i> · <a href="${html(r.url)}">open</a>`
  );
  const more = rows.length > shown.length ? `\n\n…and ${rows.length - shown.length} more on the Watchlist page.` : '';
  await sendTelegram(`<b>The Prime Radiant: ${rows.length} new alert${rows.length === 1 ? '' : 's'}</b>\n\n${lines.join('\n\n')}${more}`);
  markNotified(rows.map((r) => r.id));
};

export const sendTestTelegram = () =>
  sendTelegram('<b>The Prime Radiant</b>\nTest message: watchlist alerts will arrive here.');
