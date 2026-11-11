import React, { useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import UserProgress from './UserProgress';
import RegionClocks from './RegionClocks';
import AlertsLink from './AlertsLink';
import { CATEGORIES, COUNTRIES } from '../constants';
import './Layout.css';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

// Isolated so the per-second tick doesn't re-render the whole page.
const Clock = () => {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <time className="masthead-clock" dateTime={time.toISOString()}>
      {time.toLocaleTimeString('en-GB', { hour12: false })}
    </time>
  );
};

const Layout = ({ children }) => {
  const location = useLocation();
  const [params] = useSearchParams();
  const activeCountry = location.pathname === '/' ? params.get('country') : null;

  const today = new Date();
  const dateLine = today.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const start = new Date(today.getFullYear(), 0, 0);
  const issueNo = Math.floor((today - start) / 86400000);

  return (
    <div className="layout">
      <header className="masthead">
        <div className="masthead-strip">
          <span>Vol. {today.getFullYear() - 2024} &middot; No. {issueNo}</span>
          <span className="masthead-date">{dateLine}</span>
          <Clock />
        </div>

        <Link to="/" className="masthead-title">
          <span className="masthead-name">The Prime Radiant</span>
          <span className="masthead-motto">
            Open-source dispatches from India&rsquo;s neighbours
          </span>
        </Link>

        <RegionClocks />

        <div className="masthead-bar">
          <nav className="masthead-nav" aria-label="Main">
            <NavLink to="/" end className="nav-link">Front Page</NavLink>
            <NavLink to="/archive" className="nav-link">Archive</NavLink>
            <NavLink to="/sources" className="nav-link">Sources</NavLink>
            <NavLink to="/regional" className="nav-link">Regional</NavLink>
            <NavLink to="/veritas" className="nav-link">Veritas</NavLink>
            <AlertsLink />
          </nav>
          <UserProgress compact />
        </div>
      </header>

      <aside className="sidebar">
        <section className="sidebar-section">
          <h3 className="sidebar-title">Sections</h3>
          <nav className="sidebar-nav" aria-label="Categories">
            {CATEGORIES.map((cat, i) => (
              <NavLink key={cat.slug} to={`/category/${cat.slug}`} className="sidebar-link">
                <span className="sidebar-num">{ROMAN[i]}.</span>
                <span>{cat.name}</span>
              </NavLink>
            ))}
          </nav>
        </section>

        <section className="sidebar-section">
          <h3 className="sidebar-title">Countries</h3>
          <nav className="country-list" aria-label="Countries">
            {COUNTRIES.map((country) => (
              <Link
                key={country}
                to={activeCountry === country ? '/' : `/?country=${encodeURIComponent(country)}`}
                className={`country-link ${activeCountry === country ? 'active' : ''}`}
              >
                {country}
              </Link>
            ))}
          </nav>
        </section>

        <p className="sidebar-footer">
          Collected every ten minutes from Google News and 30+ outlets&rsquo; own feeds.
        </p>
      </aside>

      <main className="main-content">{children}</main>

      <footer className="colophon">
        Compiled from public sources. Verify before you cite.
      </footer>
    </div>
  );
};

export default Layout;
