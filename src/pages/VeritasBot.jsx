import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { veritasAPI, pickText } from '../services/api';
import { recordProgress, trackVeritasQuestion } from '../utils/gamification';
import './VeritasBot.css';

const DEFAULT_SUGGESTIONS = [
  'What are the latest developments in China-India border tensions?',
  "Analyze Pakistan's recent military activities",
  "How does Myanmar's political situation affect regional stability?",
  'Connect recent events across South Asian countries',
  'What are the economic implications of recent trade agreements?',
];

const TEXT_KEYS = ['response', 'tldr', 'summary', 'analysis', 'connections', 'result', 'answer', 'text'];
const OFFLINE = 'Veritas could not reach the server. Check that it is running (npm start).';

let nextId = 0;
const makeMessage = (type, content, extra = {}) => ({
  id: ++nextId,
  type,
  content,
  timestamp: new Date(),
  ...extra,
});

const VeritasBot = () => {
  const location = useLocation();
  const article = location.state?.article || null;

  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState([]);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(DEFAULT_SUGGESTIONS);
  const [model, setModel] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    veritasAPI
      .getSuggestions()
      .then((res) => {
        if (!cancelled && typeof res?.model === 'string') setModel(res.model);
        const list = Array.isArray(res) ? res : res?.suggestions || res?.data?.suggestions || res?.data;
        if (!cancelled && Array.isArray(list) && list.length && list.every((s) => typeof s === 'string')) {
          setSuggestions(list.slice(0, 6));
        }
      })
      .catch(() => {}); // keep the defaults
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation, loading]);

  // Shared runner: show the prompt, call the API, append the reply.
  const run = async (label, request, { countsAsQuestion = true } = {}) => {
    if (loading) return;
    setConversation((prev) => [...prev, makeMessage('user', label)]);
    setLoading(true);
    try {
      const res = await request();
      const text = pickText(res, ...TEXT_KEYS) || 'Veritas returned an empty answer.';
      setConversation((prev) => [...prev, makeMessage('ai', text)]);
      if (countsAsQuestion) recordProgress(trackVeritasQuestion);
    } catch (error) {
      console.error('Veritas error:', error);
      // The server explains what went wrong (missing key, rate limit...); fall back if unreachable.
      const reason = error?.response?.data?.error;
      setConversation((prev) => [...prev, makeMessage('ai', reason || OFFLINE, { isError: true })]);
    } finally {
      setLoading(false);
    }
  };

  const ask = (text) => {
    const q = text.trim();
    if (!q) return;
    const history = conversation
      .filter((m) => !m.isError)
      .map((m) => ({ role: m.type === 'user' ? 'user' : 'assistant', content: m.content }));
    const withContext = article && conversation.length === 0
      ? `Regarding the report "${article.headline}" (${article.source || 'unknown source'}): ${q}`
      : q;
    setQuestion('');
    run(q, () => veritasAPI.askQuestion(withContext, history));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    ask(question);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(question);
    }
  };

  const tldr = () =>
    article?._id
      ? run(`TL;DR: ${article.headline}`, () => veritasAPI.generateTLDR(article._id))
      : setQuestion('Give me a TL;DR of the most important stories today');

  const impact = () => {
    const country = article?.country;
    if (country) run(`Impact on India: ${country}`, () => veritasAPI.analyzeImpact(country, 'India'));
    else setQuestion('Analyze the impact of recent events on India');
  };

  const connect = () =>
    run('Connect events from the last 24 hours', () =>
      veritasAPI.connectEvents(
        article?.country ? [article.country] : [],
        article?.category ? [article.category] : [],
        '24hours'
      )
    );

  const formatTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="veritas">
      <div className="page-head">
        <h1>Veritas</h1>
        <p className="page-sub">
          Questions answered from the wire by a language model{model ? `, ${model}` : ''}. Check its claims against the
          sources.
        </p>
      </div>

      {article && (
        <aside className="veritas-context">
          <span className="context-label">On file</span>
          <p className="context-headline">{article.headline}</p>
          <p className="context-meta">
            {[article.source, article.sourceLabel, article.country, article.category].filter(Boolean).join(' · ')}
          </p>
        </aside>
      )}

      <div className="quick-actions">
        <button type="button" className="btn btn-ghost" onClick={tldr} disabled={loading}>TL;DR</button>
        <button type="button" className="btn btn-ghost" onClick={impact} disabled={loading}>Impact on India</button>
        <button type="button" className="btn btn-ghost" onClick={connect} disabled={loading}>Connect events</button>
        {conversation.length > 0 && (
          <button type="button" className="btn btn-ghost btn-danger" onClick={() => setConversation([])} disabled={loading}>
            Clear
          </button>
        )}
      </div>

      <div className="transcript" aria-live="polite">
        {conversation.length === 0 ? (
          <div className="transcript-empty">
            <p>Ask about any development in the region. Some places to start:</p>
            <ol className="suggestions">
              {suggestions.map((s) => (
                <li key={s}>
                  <button type="button" className="suggestion" onClick={() => setQuestion(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <>
            {conversation.map((m) => (
              <div key={m.id} className={`entry entry-${m.type} ${m.isError ? 'entry-error' : ''}`}>
                <div className="entry-head">
                  <span className="entry-who">{m.type === 'user' ? 'You' : 'Veritas'}</span>
                  <span className="entry-time">{formatTime(m.timestamp)}</span>
                </div>
                <div className="entry-body">{m.content}</div>
              </div>
            ))}
            {loading && (
              <div className="entry entry-ai">
                <div className="entry-head"><span className="entry-who">Veritas</span></div>
                <div className="entry-body typing">Composing reply<span>.</span><span>.</span><span>.</span></div>
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your question…"
          rows={2}
          disabled={loading}
          aria-label="Question for Veritas"
        />
        <button type="submit" className="btn" disabled={!question.trim() || loading}>
          {loading ? 'Sending…' : 'Send'}
        </button>
      </form>
      <p className="composer-hint">Enter to send &middot; Shift+Enter for a new line</p>
    </div>
  );
};

export default VeritasBot;
