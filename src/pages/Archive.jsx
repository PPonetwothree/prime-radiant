import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { archiveAPI } from '../services/api';
import { COUNTRIES, CATEGORIES } from '../constants';
import SourceTag from '../components/SourceTag';
import './Pages.css';

const PERIODS = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['365', 'Last year'],
];

const formatDate = (iso) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const Archive = () => {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const country = params.get('country') || 'all';
  const category = params.get('category') || 'all';
  const days = params.get('days') || '30';
  const source = params.get('source') || '';
  const page = Number(params.get('page')) || 1;

  const [draft, setDraft] = useState(q);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => setDraft(q), [q]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    archiveAPI
      .search({ q, country, category, days, source: source || undefined, page }, { signal: controller.signal })
      .then((res) => {
        setResult(res);
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [q, country, category, days, source, page]);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries({ page: '', ...changes }).forEach(([k, v]) =>
      v && v !== 'all' ? next.set(k, v) : next.delete(k)
    );
    setParams(next);
  };

  const rows = result?.data || [];

  return (
    <div className="records">
      <div className="page-head">
        <h1>Archive</h1>
        <p className="page-sub">
          Every report collected, searchable by word, country and section.
        </p>
      </div>

      <form
        className="archive-search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: draft.trim() });
        }}
      >
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search headlines and summaries, e.g. Gwadar port"
          aria-label="Search the archive"
        />
        <button type="submit" className="btn">Search</button>
      </form>

      <div className="filters" role="group" aria-label="Archive filters">
        <label className="filter">
          <span>Period</span>
          <select value={days} onChange={(e) => update({ days: e.target.value })}>
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="filter">
          <span>Country</span>
          <select value={country} onChange={(e) => update({ country: e.target.value })}>
            <option value="all">All</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="filter">
          <span>Section</span>
          <select value={category} onChange={(e) => update({ category: e.target.value })}>
            <option value="all">All</option>
            {CATEGORIES.map((c) => <option key={c.slug} value={c.name}>{c.name}</option>)}
          </select>
        </label>
        {source && (
          <button type="button" className="btn btn-ghost chip" onClick={() => update({ source: '' })}>
            Source: {source} &times;
          </button>
        )}
      </div>

      {status === 'error' ? (
        <div className="notice notice-error"><h3>Could not search the archive.</h3><p>Is the server running?</p></div>
      ) : status === 'loading' && !result ? (
        <p className="notice">Searching&hellip;</p>
      ) : (
        <>
          <p className="records-count">
            {result.total === 0
              ? 'No reports match.'
              : `${result.total} report${result.total === 1 ? '' : 's'}${result.pages > 1 ? `, page ${result.page} of ${result.pages}` : ''}`}
          </p>
          <ol className="archive-list">
            {rows.map((a) => (
              <li key={a._id}>
                <span className="archive-date">{formatDate(a.publishedTimestamp)}</span>
                <div>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="archive-headline">
                    {a.headline}
                  </a>
                  <p className="archive-meta">
                    {a.source}
                    <SourceTag type={a.sourceType} label={a.sourceLabel} note={a.sourceNote} />
                    <span> &middot; {a.country} &middot; {a.category}</span>
                    {a.severity !== 'Routine' && <span className="archive-sev"> &middot; {a.severity}</span>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {result.pages > 1 && (
            <div className="pager">
              <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                Newer
              </button>
              <button type="button" className="btn btn-ghost" disabled={page >= result.pages} onClick={() => update({ page: String(page + 1) })}>
                Older
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Archive;
