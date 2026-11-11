// Fetches an article page and pulls out its paragraph text, for Veritas.
// Deliberately simple: no headless browser, so paywalled or script-rendered
// pages return little and Veritas falls back to the headline and summary.

import { stripHtml } from './feeds.js';
import { getArticle, saveBody } from './db.js';

const MAX_BYTES = 2_000_000;
const MAX_CHARS = 8000;

const paragraphsOf = (html) =>
  [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter(
      (p) =>
        p.length > 60 &&
        // Real sentences have punctuation; navigation menus don't.
        /[.!?]["'”’)]?(\s|$)/.test(p) &&
        !/cookie|subscribe|sign up|newsletter|all rights reserved/i.test(p)
    )
    .join('\n\n');

const extractText = (html) => {
  // Pages often have many <article> elements (related-story cards etc.);
  // use the one with the most paragraph text, else the whole page.
  const best = [...html.matchAll(/<article[\s\S]*?<\/article>/gi)]
    .map((m) => paragraphsOf(m[0]))
    .sort((a, b) => b.length - a.length)[0];
  const text = best && best.length >= 300 ? best : paragraphsOf(html);
  return text.slice(0, MAX_CHARS);
};

export const articleText = async (id) => {
  const row = getArticle(id);
  if (!row) return null;
  if (row.body) return row.body;
  if (row.origin === 'google' || row.url.includes('news.google.com')) return null;

  try {
    const res = await fetch(row.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OSINT-Dashboard/1.2)', Accept: 'text/html' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return null;
    const html = (await res.text()).slice(0, MAX_BYTES);
    const text = extractText(html);
    if (text.length < 300) return null; // probably a paywall or JS-rendered page
    saveBody(id, text);
    return text;
  } catch {
    return null;
  }
};
