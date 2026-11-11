import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { archiveAPI } from '../services/api';
import { COUNTRIES } from '../constants';
import './Pages.css';

const shortDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// One row of bars per country, all on one shared scale so rows compare honestly.
const Strip = ({ country, values, dates, max }) => (
  <div className="strip" role="img" aria-label={`${country}: reports per day`}>
    {values.map((v, i) => (
      <span
        key={dates[i]}
        className="strip-bar"
        tabIndex={0}
        data-tip={`${shortDate(dates[i])}: ${v} report${v === 1 ? '' : 's'}`}
        aria-label={`${shortDate(dates[i])}: ${v}`}
      >
        <span className="strip-fill" style={{ height: `${max ? (v / max) * 100 : 0}%` }} />
      </span>
    ))}
  </div>
);

const Regional = () => {
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    setStatus('loading');
    archiveAPI
      .trends(days)
      .then((res) => {
        setData(res.data);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [days]);

  if (status === 'error') return <div className="notice notice-error"><h3>Could not load trends.</h3></div>;
  if (!data) return <p className="notice">Loading&hellip;</p>;

  const max = Math.max(1, ...COUNTRIES.flatMap((c) => data.series[c]));
  const since = data.since ? new Date(data.since) : null;
  const young = since && Date.now() - since.getTime() < days * 86400e3;

  return (
    <div className="records">
      <div className="page-head">
        <h1>Regional Overview</h1>
        <p className="page-sub">Reports per day by country, and what each country&rsquo;s coverage is about.</p>
      </div>

      <div className="filters">
        <label className="filter">
          <span>Period</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <button type="button" className="btn btn-ghost chip" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {young && (
        <p className="records-intro">
          Collection began {since.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}, so earlier days are
          empty. The archive grows by itself while the server runs.
        </p>
      )}

      {showTable ? (
        <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>Country</th>
                {data.dates.map((d) => <th key={d} className="num">{shortDate(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {COUNTRIES.map((c) => (
                <tr key={c}>
                  <td>{c}</td>
                  {data.series[c].map((v, i) => <td key={data.dates[i]} className="num">{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="strips">
          <div className="strips-scale">
            Bar height: reports per day, same scale for every country (tallest = {max})
          </div>
          {COUNTRIES.map((c) => {
            const values = data.series[c];
            const total = values.reduce((s, v) => s + v, 0);
            const cats = Object.entries(data.categories[c] || {}).sort((a, b) => b[1] - a[1]);
            return (
              <div key={c} className="strip-row">
                <div className="strip-label">
                  <Link to={`/?country=${encodeURIComponent(c)}`}>{c}</Link>
                  <span className="strip-total">{total}</span>
                </div>
                <Strip country={c} values={values} dates={data.dates} max={max} />
                <p className="strip-mix">
                  {cats.length === 0
                    ? 'No reports.'
                    : cats.slice(0, 3).map(([name, n]) => `${name} ${Math.round((n / total) * 100)}%`).join(' · ')}
                </p>
              </div>
            );
          })}
          <div className="strip-axis">
            <span>{shortDate(data.dates[0])}</span>
            <span>{shortDate(data.dates[data.dates.length - 1])}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Regional;
