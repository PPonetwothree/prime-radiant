import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { archiveAPI } from '../services/api';
import SourceTag from '../components/SourceTag';
import './Pages.css';

const TYPE_ORDER = ['local', 'exile', 'state', 'wire', 'international', 'indian', null];

const TYPE_HELP = {
  state: 'Run or controlled by a government. Read as the official line, not independent confirmation.',
  exile: 'Independent outlets reporting from outside the country, often on what domestic media cannot cover.',
  local: 'Domestic private outlets. Some work under censorship (e.g. Taliban media rules).',
  wire: 'International news agencies.',
  international: 'Foreign and regional outlets.',
  indian: "Indian outlets: India's perspective on its neighbours.",
};

const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

const Sources = () => {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    archiveAPI
      .sources()
      .then((res) => {
        setData(res.data);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    const list = data.outlets.filter((o) => !f || o.source.toLowerCase().includes(f));
    return TYPE_ORDER.map((type) => ({
      type,
      label: type ? data.types[type] : 'Not yet classified',
      outlets: list.filter((o) => (o.type || null) === type),
    })).filter((g) => g.outlets.length);
  }, [data, filter]);

  if (status === 'error') {
    return <div className="notice notice-error"><h3>Could not load sources.</h3></div>;
  }
  if (!data) return <p className="notice">Loading sources&hellip;</p>;

  const failing = data.feeds.filter((f) => !f.ok);

  return (
    <div className="records">
      <div className="page-head">
        <h1>Sources</h1>
        <p className="page-sub">
          {data.outlets.length} outlets in the last 30 days &middot; {data.feeds.length - failing.length}/{data.feeds.length} direct feeds working
        </p>
      </div>

      <p className="records-intro">
        Reports arrive two ways: Google News searches for each country, and {data.feeds.length - 7} feeds read
        directly from the outlets themselves (marked &ldquo;direct&rdquo;). Each outlet is labelled by who runs it. Labels describe ownership, not accuracy.
      </p>

      <input
        type="search"
        className="records-filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter outlets"
        aria-label="Filter outlets"
      />

      {groups.map((g) => (
        <section key={g.type || 'none'} className="source-group">
          <h2>
            {g.label} <span className="source-group-count">{g.outlets.length}</span>
          </h2>
          {g.type && <p className="source-help">{TYPE_HELP[g.type]}</p>}
          <table className="ledger">
            <thead>
              <tr>
                <th>Outlet</th>
                <th>Covers</th>
                <th className="num">Reports</th>
                <th>Last report</th>
              </tr>
            </thead>
            <tbody>
              {g.outlets.map((o) => (
                <tr key={o.source}>
                  <td>
                    <Link to={`/archive?source=${encodeURIComponent(o.source)}`}>{o.source}</Link>
                    {o.direct && <span className="direct-mark" title="Read from the outlet's own feed"> &#8226; direct</span>}
                    {o.note && <span className="source-note">{o.note}</span>}
                  </td>
                  <td>{o.countries.join(', ')}</td>
                  <td className="num">{o.count}</td>
                  <td>{ago(o.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="source-group">
        <h2>Feed health</h2>
        <p className="source-help">Checked on every refresh. A feed that keeps failing may have moved or started blocking readers.</p>
        <table className="ledger">
          <thead>
            <tr>
              <th>Feed</th>
              <th>Country</th>
              <th>Status</th>
              <th className="num">Items</th>
              <th>Last success</th>
            </tr>
          </thead>
          <tbody>
            {data.feeds.map((f) => (
              <tr key={f.id} className={f.ok ? '' : 'feed-failing'}>
                <td>{f.name}</td>
                <td>{f.country || 'Regional'}</td>
                <td>{f.ok ? 'OK' : `Failing: ${f.error}`}</td>
                <td className="num">{f.ok ? f.items : '—'}</td>
                <td>{ago(f.lastOkAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="records-intro">
        <SourceTag type="state" label="State media" /> <SourceTag type="exile" label="Exile media" />{' '}
        <SourceTag type="local" label="Local" /> &mdash; these labels also appear next to every report.
      </p>
    </div>
  );
};

export default Sources;
