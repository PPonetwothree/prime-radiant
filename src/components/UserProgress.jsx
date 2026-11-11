import React, { useState, useEffect } from 'react';
import {
  initializeProgress,
  getLevelInfo,
  getProgressToNextLevel,
  getUnlockedAchievements,
  updateStreak,
  saveProgress,
  ACHIEVEMENTS,
} from '../utils/gamification';
import { COUNTRIES } from '../constants';
import './UserProgress.css';

const UserProgress = ({ compact = false }) => {
  const [progress, setProgress] = useState(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const result = updateStreak(initializeProgress());
    saveProgress(result.progress);
    setProgress(result.progress);

    let noticeTimer;
    // event.detail is a tracker result: { progress, leveledUp, ... }
    const handleProgressUpdate = (event) => {
      const detail = event.detail || {};
      if (detail.progress) setProgress(detail.progress);
      if (detail.leveledUp) {
        setNotice(getLevelInfo(detail.progress.xp));
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => setNotice(null), 3500);
      }
    };

    window.addEventListener('progressUpdate', handleProgressUpdate);
    return () => {
      window.removeEventListener('progressUpdate', handleProgressUpdate);
      clearTimeout(noticeTimer);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!progress || !compact) return null;

  const levelInfo = getLevelInfo(progress.xp);
  const next = getProgressToNextLevel(progress.xp);
  const unlocked = getUnlockedAchievements(progress);
  const { stats } = progress;

  return (
    <div className="rank">
      <button type="button" className="rank-button" onClick={() => setOpen(true)}>
        <span className="rank-level">Rank {levelInfo.level}</span>
        <span className="rank-name">{levelInfo.name}</span>
        <span className="rank-bar" aria-hidden="true">
          <span className="rank-fill" style={{ width: `${next.percentage}%` }} />
        </span>
        <span className="rank-xp">
          {next.maxed ? `${progress.xp} XP` : `${next.current}/${next.needed} XP`}
        </span>
      </button>

      {notice && (
        <div className="rank-notice" role="status">
          Promoted to Rank {notice.level}: {notice.name}
        </div>
      )}

      {open && (
        <div className="record-overlay" onClick={() => setOpen(false)}>
          <div
            className="record"
            role="dialog"
            aria-modal="true"
            aria-labelledby="record-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="record-head">
              <h2 id="record-title">Service Record</h2>
              <button type="button" className="record-close" onClick={() => setOpen(false)} aria-label="Close">
                &times;
              </button>
            </div>

            <p className="record-rank">
              Rank {levelInfo.level} &mdash; {levelInfo.name} &middot; {progress.xp} XP total
            </p>

            <dl className="record-stats">
              <div><dt>Articles read</dt><dd>{stats.articlesRead}</dd></div>
              <div><dt>Questions asked</dt><dd>{stats.questionsAsked}</dd></div>
              <div><dt>Day streak</dt><dd>{stats.currentStreak}</dd></div>
              <div><dt>Countries</dt><dd>{stats.countriesExplored.length}/{COUNTRIES.length}</dd></div>
            </dl>

            <h3 className="record-sub">
              Commendations ({unlocked.length}/{ACHIEVEMENTS.length})
            </h3>
            {unlocked.length === 0 ? (
              <p className="record-empty">None yet. Read a report or ask Veritas a question.</p>
            ) : (
              <ul className="record-list">
                {unlocked.map((a) => (
                  <li key={a.id}>
                    <strong>{a.name}</strong> &mdash; {a.description}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default UserProgress;
