import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { articlesAPI, pickList } from '../services/api';
import { recordProgress, trackArticleRead } from '../utils/gamification';
import { COUNTRIES, toClassName } from '../constants';
import SourceTag from '../components/SourceTag';
import './Dashboard.css';

const REFRESH_MS = 120000;

const getTimeAgo = (timestamp) => {
  const t = new Date(timestamp).getTime();
  if (!timestamp || Number.isNaN(t)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const Dashboard = ({ category = null, title = 'Live Intelligence Feed' }) => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const country = params.get('country') || 'all';

  const [articles, setArticles] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [timeFilter, setTimeFilter] = useState('24hours');
  const [severity, setSeverity] = useState('all');

  useEffect(() => {
    const controller = new AbortController();
    const query = { timeFilter, severity, country, category: category || 'all' };

    let loaded = false;

    const load = async () => {
      try {
        const res = await articlesAPI.getArticles(query, { signal: controller.signal });
        const list = pickList(res);
        setArticles(list);
        setTotal(typeof res?.count === 'number' ? res.count : list.length);
        setStatus('ready');
        loaded = true;
      } catch {
        if (controller.signal.aborted) return; // superseded by a newer filter
        // A failed background refresh keeps the reports already on screen.
        if (!loaded) setStatus('error');
      }
    };

    setStatus('loading');
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [timeFilter, severity, country, category]);

  const setCountry = (value) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('country');
    else next.set('country', value);
    setParams(next);
  };

  const track = useCallback((article) => recordProgress(trackArticleRead, article), []);

  const handleAskVeritas = (article) => {
    track(article);
    navigate('/veritas', { state: { article } });
  };

  const sourceCount = new Set(articles.map((a) => a.source).filter(Boolean)).size;

  // Front page leads with the newest Breaking story (else High Priority); the rest stay in time order.
  const ordered = useMemo(() => {
    const lead =
      articles.findIndex((a) => a.severity === 'Breaking') >= 0
        ? articles.findIndex((a) => a.severity === 'Breaking')
        : Math.max(0, articles.findIndex((a) => a.severity === 'High Priority'));
    if (lead <= 0) return articles;
    return [articles[lead], ...articles.slice(0, lead), ...articles.slice(lead + 1)];
  }, [articles]);

  return (
    <div className="dashboard">
      <div className="page-head">
        <h1>{title}</h1>
        <p className="page-sub">
          {status === 'ready'
            ? `${total} report${total === 1 ? '' : 's'}${total > articles.length ? ` (latest ${articles.length} shown)` : ''} from ${sourceCount} source${sourceCount === 1 ? '' : 's'}`
            : status === 'loading'
              ? 'Gathering reports…'
              : 'Wire service unavailable'}
        </p>
      </div>

      <div className="filters" role="group" aria-label="Filters">
        <label className="filter">
          <span>Period</span>
          <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)}>
            <option value="2min">Last 2 minutes</option>
            <option value="15min">Last 15 minutes</option>
            <option value="1hour">Last hour</option>
            <option value="6hours">Last 6 hours</option>
            <option value="24hours">Last 24 hours</option>
          </select>
        </label>

        <label className="filter">
          <span>Priority</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="all">All</option>
            <option value="Breaking">Breaking</option>
            <option value="High Priority">High priority</option>
            <option value="Routine">Routine</option>
          </select>
        </label>

        <label className="filter">
          <span>Country</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="all">All</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      {status === 'loading' && articles.length === 0 ? (
        <p className="notice">Loading reports&hellip;</p>
      ) : status === 'error' ? (
        <div className="notice notice-error">
          <h3>Could not reach the news service.</h3>
          <p>The backend may be asleep or offline. It will retry automatically every two minutes.</p>
        </div>
      ) : articles.length === 0 ? (
        <div className="notice">
          <h3>No reports filed.</h3>
          <p>Try a wider period or different filters.</p>
        </div>
      ) : (
        <div className="articles">
          {ordered.map((article, i) => {
            const sev = article.severity || 'Routine';
            const related = article.relatedSources?.length || 0;
            return (
              <article key={article._id || article.url || i} className={`article ${i === 0 ? 'lead' : ''}`}>
                <div className="article-kicker">
                  <span className={`stamp stamp-${toClassName(sev)}`}>{sev}</span>
                  <span className="article-time">{getTimeAgo(article.publishedTimestamp)}</span>
                </div>

                <h3 className="article-headline">{article.headline || 'Untitled report'}</h3>

                {i === 0 && article.summary && <p className="article-dek">{article.summary}</p>}

                <p className="article-meta">
                  {[article.country, article.category].filter(Boolean).join(' · ')}
                </p>

                <p className="article-source">
                  {article.source || 'Unknown source'}
                  <SourceTag type={article.sourceType} label={article.sourceLabel} note={article.sourceNote} />
                  {related > 0 && (
                    <span
                      className="related"
                      title={article.relatedSources.map((r) => r.source + (r.sourceLabel ? ` (${r.sourceLabel})` : '')).join(', ')}
                    >
                      {' '}&amp; {related} more
                    </span>
                  )}
                </p>

                <div className="article-actions">
                  {article.url && (
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost"
                      onClick={() => track(article)}
                    >
                      Read original
                    </a>
                  )}
                  <button type="button" className="btn" onClick={() => handleAskVeritas(article)}>
                    Ask Veritas
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
