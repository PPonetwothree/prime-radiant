import React, { useCallback, useEffect, useState } from 'react';
import { watchlistAPI } from '../services/api';
import { COUNTRIES, toClassName } from '../constants';
import SourceTag from '../components/SourceTag';
import './Pages.css';

const PRESETS = [
  {
    name: "India's borders",
    terms: 'LAC, Line of Actual Control, LoC, Line of Control, Arunachal, Ladakh, Doklam, Sikkim, Kashmir, border clash*',
    minSeverity: 'Routine',
  },
  {
    name: 'Militancy',
    terms: 'TTP, Baloch*, BLA, Arakan Army, ISKP, Islamic State, militant*, suicide bomb*',
    minSeverity: 'High Priority',
  },
  {
    name: 'Corridors and ports',
    terms: 'CPEC, Gwadar, Belt and Road, BRI, Kyaukphyu, Chittagong port, Chattogram port, Mongla, Hambantota',
    minSeverity: 'Routine',
  },
  {
    name: 'Coups and emergencies',
    terms: 'coup, martial law, state of emergency, curfew, resign*, ousted, no-confidence',
    minSeverity: 'High Priority',
  },
];

const EMPTY = { name: '', terms: '', countries: [], minSeverity: 'Routine', telegram: false };

const formatDate = (iso) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const notificationState = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

const Watchlist = () => {
  const [rules, setRules] = useState([]);
  const [telegram, setTelegram] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [unread, setUnread] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filterRule, setFilterRule] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [notify, setNotify] = useState(notificationState);
  const [status, setStatus] = useState('loading');
  const [notice, setNotice] = useState(null);

  const loadRules = useCallback(async () => {
    const res = await watchlistAPI.list();
    setRules(res.data.rules);
    setTelegram(res.data.telegram);
  }, []);

  const loadAlerts = useCallback(async () => {
    const res = await watchlistAPI.alerts({ rule: filterRule || undefined, unread: unreadOnly ? '1' : undefined, limit: 200 });
    setAlerts(res.data);
    setUnread(res.unread);
    window.dispatchEvent(new CustomEvent('alertsChanged', { detail: { unread: res.unread } }));
  }, [filterRule, unreadOnly]);

  useEffect(() => {
    Promise.all([loadRules(), loadAlerts()])
      .then(() => setStatus('ready'))
      .catch(() => setStatus('error'));
  }, [loadRules, loadAlerts]);

  // Refresh when the layout's poll sees new alerts.
  useEffect(() => {
    const onNew = () => Promise.all([loadRules(), loadAlerts()]).catch(() => {});
    window.addEventListener('alertsArrived', onNew);
    return () => window.removeEventListener('alertsArrived', onNew);
  }, [loadRules, loadAlerts]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await watchlistAPI.create(form);
      setForm(EMPTY);
      setNotice(`"${res.data.name}" added: ${res.data.alertCount} matching ${res.data.alertCount === 1 ? 'story' : 'stories'} from the last 48 hours.`);
      await Promise.all([loadRules(), loadAlerts()]);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save the rule.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (rule, key) => {
    await watchlistAPI.update(rule.id, { [key]: !rule[key] });
    await Promise.all([loadRules(), loadAlerts()]);
  };

  const remove = async (rule) => {
    if (!window.confirm(`Delete the rule "${rule.name}" and its ${rule.alertCount} alerts? This cannot be undone.`)) return;
    await watchlistAPI.remove(rule.id);
    if (String(rule.id) === filterRule) setFilterRule('');
    await Promise.all([loadRules(), loadAlerts()]);
  };

  const markRead = async (body) => {
    await watchlistAPI.markRead(body);
    await Promise.all([loadRules(), loadAlerts()]);
  };

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    setNotify(await Notification.requestPermission());
  };

  const testTelegram = async () => {
    try {
      await watchlistAPI.testTelegram();
      setNotice('Test message sent to Telegram.');
    } catch (err) {
      setNotice(err?.response?.data?.error || 'Telegram test failed.');
    }
  };

  const toggleCountry = (c) =>
    setForm((f) => ({ ...f, countries: f.countries.includes(c) ? f.countries.filter((x) => x !== c) : [...f.countries, c] }));

  if (status === 'error') return <div className="notice notice-error"><h3>Could not load the watchlist.</h3></div>;

  return (
    <div className="records">
      <div className="page-head">
        <h1>Watchlist</h1>
        <p className="page-sub">
          {rules.length} rule{rules.length === 1 ? '' : 's'} &middot; {unread} unread alert{unread === 1 ? '' : 's'}
        </p>
      </div>

      <p className="records-intro">
        Name the words, places, people or groups you care about. Each new story that matches becomes an alert here
        {telegram ? ' and, if you tick Telegram, on your phone' : ''}. Alerts wait until a story&rsquo;s priority is
        settled, so expect them a few minutes after a story appears.
      </p>

      <div className="delivery">
        <span>
          Desktop notifications:{' '}
          {notify === 'granted' ? <strong>on</strong> : notify === 'denied' ? 'blocked in browser settings' : notify === 'unsupported' ? 'not supported here' : 'off'}
          {notify === 'default' && (
            <button type="button" className="btn btn-ghost chip" onClick={enableNotifications}>Turn on</button>
          )}
          <span className="delivery-note"> (while this site is open in a tab)</span>
        </span>
        <span>
          Telegram: {telegram ? <strong>connected</strong> : 'not set up'}
          {telegram && (
            <button type="button" className="btn btn-ghost chip" onClick={testTelegram}>Send test</button>
          )}
          {!telegram && <span className="delivery-note"> (add a bot token to .env, see README)</span>}
        </span>
      </div>

      {notice && <p className="flash" role="status">{notice}</p>}

      <section className="source-group">
        <h2>New rule</h2>
        <p className="source-help">
          Start from a preset or write your own. Separate terms with commas. A term ending in * also matches longer
          words (militant* finds &ldquo;militants&rdquo;).
        </p>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" className="btn btn-ghost chip" onClick={() => setForm({ ...EMPTY, ...p })}>
              {p.name}
            </button>
          ))}
        </div>

        <form className="rule-form" onSubmit={submit}>
          <label className="field">
            <span>Name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} placeholder="e.g. Gwadar port" />
          </label>
          <label className="field">
            <span>Watch for</span>
            <textarea
              value={form.terms}
              onChange={(e) => setForm({ ...form, terms: e.target.value })}
              rows={2}
              placeholder="Gwadar, CPEC, Baloch*"
            />
          </label>
          <fieldset className="field">
            <legend>Countries <em>(none ticked = all)</em></legend>
            <div className="checks">
              {COUNTRIES.map((c) => (
                <label key={c}>
                  <input type="checkbox" checked={form.countries.includes(c)} onChange={() => toggleCountry(c)} /> {c}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field-row">
            <label className="field">
              <span>Minimum priority</span>
              <select value={form.minSeverity} onChange={(e) => setForm({ ...form, minSeverity: e.target.value })}>
                <option value="Routine">Any</option>
                <option value="High Priority">High priority or Breaking</option>
                <option value="Breaking">Breaking only</option>
              </select>
            </label>
            <label className={`field field-check ${telegram ? '' : 'is-disabled'}`}>
              <input
                type="checkbox"
                checked={form.telegram}
                disabled={!telegram}
                onChange={(e) => setForm({ ...form, telegram: e.target.checked })}
              />
              <span>Also send to Telegram</span>
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Add rule'}</button>
        </form>
      </section>

      {rules.length > 0 && (
        <section className="source-group">
          <h2>Rules</h2>
          <table className="ledger rules-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Countries</th>
                <th>Priority</th>
                <th className="num">Alerts</th>
                <th>On</th>
                <th aria-label="Delete" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={r.enabled ? '' : 'rule-off'}>
                  <td>
                    <button type="button" className="linklike" onClick={() => setFilterRule(String(r.id))}>{r.name}</button>
                    <span className="source-note">{r.terms.join(', ')}</span>
                    {r.telegram && <span className="direct-mark"> &#8226; Telegram</span>}
                  </td>
                  <td>{r.countries.length ? r.countries.join(', ') : 'All'}</td>
                  <td>{r.minSeverity === 'Routine' ? 'Any' : r.minSeverity === 'Breaking' ? 'Breaking' : 'High+'}</td>
                  <td className="num">
                    {r.alertCount}
                    {r.unread > 0 && <span className="unread-mark"> ({r.unread} new)</span>}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={() => toggle(r, 'enabled')}
                      aria-label={`${r.enabled ? 'Pause' : 'Resume'} ${r.name}`}
                    />
                  </td>
                  <td>
                    <button type="button" className="linklike danger" onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="source-group">
        <h2>Alerts</h2>
        <div className="filters">
          <label className="filter">
            <span>Rule</span>
            <select value={filterRule} onChange={(e) => setFilterRule(e.target.value)}>
              <option value="">All rules</option>
              {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="filter filter-check">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            <span>Unread only</span>
          </label>
          {unread > 0 && (
            <button type="button" className="btn btn-ghost chip" onClick={() => markRead({ all: true })}>
              Mark all read
            </button>
          )}
        </div>

        {alerts.length === 0 ? (
          <p className="records-count">{rules.length ? 'No alerts yet.' : 'Add a rule to start receiving alerts.'}</p>
        ) : (
          <ol className="archive-list alert-list">
            {alerts.map((a) => (
              <li key={a.id} className={a.read ? 'is-read' : ''}>
                <span className="archive-date">
                  {formatDate(a.article.publishedTimestamp)}
                  {!a.read && <span className="new-dot" aria-label="unread"> &#9679;</span>}
                </span>
                <div>
                  <span className={`stamp stamp-${toClassName(a.article.severity)}`}>{a.article.severity}</span>{' '}
                  <a
                    href={a.article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="archive-headline"
                    onClick={() => !a.read && markRead({ ids: [a.id] })}
                  >
                    {a.article.headline}
                  </a>
                  <p className="archive-meta">
                    {a.article.source}
                    <SourceTag type={a.article.sourceType} label={a.article.sourceLabel} note={a.article.sourceNote} />
                    <span> &middot; {a.article.country}</span>
                    <span className="alert-why"> &middot; {a.ruleName}: &ldquo;{a.matched}&rdquo;</span>
                    {!a.read && (
                      <button type="button" className="linklike" onClick={() => markRead({ ids: [a.id] })}>
                        {' '}mark read
                      </button>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
};

export default Watchlist;
