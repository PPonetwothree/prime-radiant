import React, { useEffect, useState } from 'react';

// Capitals of the tracked countries, with New Delhi as the reference.
const PLACES = [
  { city: 'New Delhi', country: 'India', tz: 'Asia/Kolkata' },
  { city: 'Islamabad', country: 'Pakistan', tz: 'Asia/Karachi' },
  { city: 'Kabul', country: 'Afghanistan', tz: 'Asia/Kabul' },
  { city: 'Kathmandu', country: 'Nepal', tz: 'Asia/Kathmandu' },
  { city: 'Thimphu', country: 'Bhutan', tz: 'Asia/Thimphu' },
  { city: 'Dhaka', country: 'Bangladesh', tz: 'Asia/Dhaka' },
  { city: 'Naypyidaw', country: 'Myanmar', tz: 'Asia/Yangon' },
  { city: 'Beijing', country: 'China', tz: 'Asia/Shanghai' },
];

const REFERENCE = 'Asia/Kolkata';

const minutesOfDay = (date, tz) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return Number(parts.hour) * 60 + Number(parts.minute);
};

// Offset from IST, e.g. "−0:30" or "+2:30". Computed, so it stays right if a zone changes.
const offsetFromIst = (date, tz) => {
  let diff = minutesOfDay(date, tz) - minutesOfDay(date, REFERENCE);
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  if (diff === 0) return 'IST';
  const sign = diff > 0 ? '+' : '−';
  const abs = Math.abs(diff);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
};

const formatTime = (date, tz) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);

// Working hours (08:00–20:00 local) are shown in full ink; night is faded,
// a quick cue for when an official statement or a quiet night is likely.
const isDaytime = (date, tz) => {
  const m = minutesOfDay(date, tz);
  return m >= 8 * 60 && m < 20 * 60;
};

const RegionClocks = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Tick on the minute boundary, then every minute.
    let interval;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60000);
    }, 60000 - (Date.now() % 60000) + 50);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  return (
    <ul className="region-clocks" aria-label="Local times">
      {PLACES.map((p) => (
        <li key={p.tz} className={isDaytime(now, p.tz) ? '' : 'is-night'} title={`${p.city}, ${p.country}`}>
          <span className="rc-city">{p.city}</span>
          <time className="rc-time">{formatTime(now, p.tz)}</time>
          <span className="rc-offset">{offsetFromIst(now, p.tz)}</span>
        </li>
      ))}
    </ul>
  );
};

export default RegionClocks;
