// Veritas: answers questions with a language model, grounded in current reports.
// Provider: Groq if GROQ_API_KEY is set, else Gemini if GEMINI_API_KEY is set.
// Force one with LLM_PROVIDER=groq|gemini.

const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const SYSTEM = `You are Veritas, an open-source intelligence analyst covering India's neighbours:
Pakistan, China, Bangladesh, Myanmar, Nepal, Bhutan and Afghanistan.

You are given a list of recent news reports with their source and date. Base your answer on
those reports. Name the outlet when you rely on a report. If the reports don't cover what
was asked, say so plainly instead of guessing; you may add well-established background, but
label it as background. Usually you see only headlines and short summaries, so be careful
with detail.

Each report is tagged with who runs the outlet: "State media" (government-controlled),
"Exile media", "Local", "Wire", "Indian" or "International". Treat state media as the
official position of that government, not as independent confirmation. When a claim rests
only on state media or on a single outlet, say so. Note when independent outlets agree.

Write in plain text (no Markdown, no tables, no bullet symbols other than "-"), short
paragraphs, under 250 words unless asked for more.`;

export class VeritasError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const provider = () => {
  const forced = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (forced === 'groq' && process.env.GROQ_API_KEY) return 'groq';
  if (forced === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
};

export const isConfigured = () => Boolean(provider());

export const providerLabel = () => {
  const p = provider();
  if (p === 'groq') return `Groq (${GROQ_MODEL})`;
  if (p === 'gemini') return `Gemini (${GEMINI_MODEL})`;
  return null;
};

// How much report text to send per request (~4 characters per token). Groq's
// free tier allows 8,000 tokens per minute, so its default fits ~2 questions/min.
export const contextBudget = () =>
  Number(process.env.CONTEXT_CHARS) || (provider() === 'groq' ? 8000 : 40000);

const outlet = (s) => `${s.source}${s.sourceLabel ? ` (${s.sourceLabel})` : ''}`;

export const formatHeadlines = (articles, { summaries = true, maxChars = contextBudget() } = {}) => {
  const lines = [];
  let used = 0;
  for (const [i, a] of articles.entries()) {
    const date = new Date(a.publishedTimestamp).toISOString().slice(0, 16).replace('T', ' ');
    const also = a.relatedSources?.length ? `; also reported by ${a.relatedSources.map(outlet).join(', ')}` : '';
    const dek = summaries && a.summary ? `\n   ${a.summary.slice(0, 200)}` : '';
    const line = `${i + 1}. [${date} UTC | ${a.country} | ${a.category} | ${a.severity}] ${a.headline} - ${outlet(a)}${also}${dek}`;
    if (used + line.length > maxChars && lines.length) break; // newest first, so drop the oldest
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
};

const cleanHistory = (history) =>
  history
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .slice(-6)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 2000) }));

const post = async (url, headers, body, name) => {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new VeritasError(`Could not reach ${name}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  }
};

const failure = (name, status, msg, model) => {
  console.error(`[veritas] ${name} error ${status}:`, msg);
  if (status === 401 || status === 403) return new VeritasError(`${name} rejected the API key. Check it in .env.`, 502);
  if (status === 404) return new VeritasError(`${name} model "${model}" not found. Set a current model in .env.`, 502);
  if (status === 413) return new VeritasError(`Request too large for ${name}'s limits. Lower CONTEXT_CHARS in .env.`, 502);
  if (status === 429) return new VeritasError(`${name} rate limit reached. Try again in a minute.`, 429);
  return new VeritasError(`${name} error: ${msg}`);
};

// OpenAI-compatible chat completions endpoint.
const groq = async (prompt, history, retried = false) => {
  const res = await post(
    'https://api.groq.com/openai/v1/chat/completions',
    { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    {
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: SYSTEM }, ...cleanHistory(history), { role: 'user', content: prompt }],
      temperature: 0.3,
      max_completion_tokens: 1200,
      // gpt-oss models reason before answering; keep that short to save tokens.
      ...(GROQ_MODEL.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
    },
    'Groq'
  );
  // Per-minute token limit: if Groq says the wait is short, wait and retry once.
  const wait = Number(res.headers.get('retry-after'));
  if (res.status === 429 && !retried && wait > 0 && wait <= 20) {
    await new Promise((r) => setTimeout(r, wait * 1000 + 250));
    return groq(prompt, history, true);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw failure('Groq', res.status, data?.error?.message || `HTTP ${res.status}`, GROQ_MODEL);
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new VeritasError(`Groq returned no text (${data?.choices?.[0]?.finish_reason || 'unknown'}).`);
  return text;
};

const gemini = async (prompt, history) => {
  const res = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
    { 'x-goog-api-key': process.env.GEMINI_API_KEY },
    {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        ...cleanHistory(history).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        { role: 'user', parts: [{ text: prompt }] },
      ],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    },
    'Gemini'
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw failure('Gemini', res.status, data?.error?.message || `HTTP ${res.status}`, GEMINI_MODEL);
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
    throw new VeritasError(`Gemini returned no text${reason ? ` (${reason})` : ''}.`);
  }
  return text;
};

// JSON-mode Groq call, used by the story tagger. Returns the parsed object.
// Throws VeritasError (status 429 on rate limit) so callers can back off.
export const groqJson = async ({ model, system, user, maxTokens = 3000 }) => {
  if (!process.env.GROQ_API_KEY) throw new VeritasError('No GROQ_API_KEY', 503);
  const res = await post(
    'https://api.groq.com/openai/v1/chat/completions',
    { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0,
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
      ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
    },
    'Groq'
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = failure('Groq', res.status, data?.error?.message || `HTTP ${res.status}`, model);
    err.retryAfter = Number(res.headers.get('retry-after')) || null;
    throw err;
  }
  const content = data?.choices?.[0]?.message?.content;
  try {
    return { json: JSON.parse(content), usage: data.usage };
  } catch {
    throw new VeritasError(`Groq returned invalid JSON (${data?.choices?.[0]?.finish_reason || 'unknown'}).`);
  }
};

// Models add Markdown despite instructions; the page shows plain text.
const toPlainText = (text) =>
  text
    .replace(/\s*【[^】]*】/g, '') // gpt-oss citation markers like 【6†source】
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*(\S[^*\n]*?)\*(?=\s|[.,;:!?)]|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// history: [{ role: 'user' | 'assistant', content }]
export const generate = async (prompt, history = []) => {
  const p = provider();
  if (!p) {
    throw new VeritasError('Veritas needs an API key. Add GROQ_API_KEY (or GEMINI_API_KEY) to the .env file and restart the server.', 503);
  }
  return toPlainText(await (p === 'groq' ? groq(prompt, history) : gemini(prompt, history)));
};
