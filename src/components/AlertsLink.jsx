import React, { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { watchlistAPI } from '../services/api';

const POLL_MS = 60000;

// "Watchlist" nav link with an unread badge. Polls the server and raises a
// desktop notification when new alerts arrive (if the viewer allowed them).
const AlertsLink = () => {
  const [unread, setUnread] = useState(0);
  const lastCount = useRef(null);
  // Highest alert id seen. Alert ids only grow, so a higher one means a genuinely
  // new alert (counts can also move when alerts are read or rules deleted).
  // null until the first poll, so opening the page never notifies.
  const lastId = useRef(null);

  useEffect(() => {
    let stopped = false;

    const poll = async () => {
      try {
        const res = await watchlistAPI.count();
        if (stopped) return;
        const latestId = res.newestId ?? 0;
        const isNew = lastId.current !== null && latestId > lastId.current;
        const changed = lastCount.current !== null && res.unread !== lastCount.current;
        lastId.current = Math.max(lastId.current ?? 0, latestId);
        lastCount.current = res.unread;
        setUnread(res.unread);

        if (isNew || changed) window.dispatchEvent(new CustomEvent('alertsArrived'));
        if (isNew && res.latest && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const n = new Notification(`${res.latest.severity}: ${res.latest.rule}`, {
            body: res.latest.headline,
            tag: 'prime-radiant-alerts', // replaces the previous one instead of stacking
          });
          n.onclick = () => {
            window.focus();
            window.location.assign('/watchlist');
          };
        }
      } catch {
        /* server unreachable: try again next tick */
      }
    };

    // The Watchlist page reports read/unread changes so the badge updates at once.
    const onChanged = (e) => {
      lastCount.current = e.detail.unread;
      setUnread(e.detail.unread);
    };

    poll();
    const timer = setInterval(poll, POLL_MS);
    window.addEventListener('alertsChanged', onChanged);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('alertsChanged', onChanged);
    };
  }, []);

  return (
    <NavLink to="/watchlist" className="nav-link">
      Watchlist
      {unread > 0 && (
        <span className="nav-badge" aria-label={`${unread} unread alerts`}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </NavLink>
  );
};

export default AlertsLink;
