// Gamification utility functions for OSINT News Aggregator

const LEVELS = [
  { level: 1, name: 'Analyst', minXP: 0, maxXP: 100, color: '#6b7280' },
  { level: 2, name: 'Investigator', minXP: 100, maxXP: 300, color: '#8b5cf6' },
  { level: 3, name: 'Specialist', minXP: 300, maxXP: 600, color: '#00d4ff' },
  { level: 4, name: 'Expert', minXP: 600, maxXP: 1000, color: '#10b981' },
  { level: 5, name: 'Senior Analyst', minXP: 1000, maxXP: 1500, color: '#f59e0b' },
  { level: 6, name: 'Chief Analyst', minXP: 1500, maxXP: 2200, color: '#ef4444' },
  { level: 7, name: 'Intelligence Officer', minXP: 2200, maxXP: 3000, color: '#ec4899' },
  { level: 8, name: 'Senior Officer', minXP: 3000, maxXP: 4000, color: '#8b5cf6' },
  { level: 9, name: 'Deputy Director', minXP: 4000, maxXP: 5500, color: '#00d4ff' },
  { level: 10, name: 'Intelligence Director', minXP: 5500, maxXP: Infinity, color: '#ffd700' }
];

const ACHIEVEMENTS = [
  { id: 'first_article', name: 'First Steps', description: 'Read your first article', icon: '🏆', xp: 50 },
  { id: 'curious_mind', name: 'Curious Mind', description: 'Ask Veritas 10 questions', icon: '🔍', xp: 100 },
  { id: 'news_junkie', name: 'News Junkie', description: 'Read 100 articles', icon: '📰', xp: 500 },
  { id: 'week_streak', name: 'On Fire', description: 'Maintain a 7-day streak', icon: '🔥', xp: 200 },
  { id: 'speed_reader', name: 'Speed Reader', description: 'Read 10 articles in one session', icon: '⚡', xp: 150 },
  { id: 'global_awareness', name: 'Global Awareness', description: 'Read articles from all 7 countries', icon: '🌍', xp: 300 },
  { id: 'category_master', name: 'Category Master', description: 'Read 50 articles in one category', icon: '🎯', xp: 250 },
  { id: 'ai_whisperer', name: 'AI Whisperer', description: 'Have 50 conversations with Veritas', icon: '💬', xp: 400 },
  { id: 'breaking_hunter', name: 'Breaking News Hunter', description: 'Read 20 breaking news articles', icon: '🚨', xp: 200 },
  { id: 'elite_analyst', name: 'Elite Analyst', description: 'Reach level 10', icon: '⭐', xp: 1000 },
  { id: 'early_bird', name: 'Early Bird', description: 'Read news before 6 AM', icon: '🌅', xp: 100 },
  { id: 'night_owl', name: 'Night Owl', description: 'Read news after midnight', icon: '🦉', xp: 100 },
  { id: 'deep_dive', name: 'Deep Dive', description: 'Spend 30+ minutes in one session', icon: '🤿', xp: 150 },
  { id: 'share_master', name: 'Share Master', description: 'Share 25 articles', icon: '📤', xp: 200 },
  { id: 'veritas_expert', name: 'Veritas Expert', description: 'Ask 5 different types of questions', icon: '🧠', xp: 250 }
];

const XP_REWARDS = {
  READ_ARTICLE: 10,
  ASK_VERITAS: 25,
  SHARE_ARTICLE: 5,
  DAILY_LOGIN: 50,
  COMPLETE_CHALLENGE: 100,
  BREAKING_NEWS_FIRST: 50,
  MARK_AS_READ: 5
};

// Initialize user progress
const STORAGE_KEY = 'osint_progress';

const readStored = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupted JSON or storage blocked
  }
};

// Older saves stored categoriesExplored as an array; it is a count map.
const normalize = (progress) => {
  const stats = progress.stats || {};
  return {
    ...progress,
    achievements: progress.achievements || [],
    stats: {
      ...stats,
      countriesExplored: Array.isArray(stats.countriesExplored) ? stats.countriesExplored : [],
      categoriesExplored:
        stats.categoriesExplored && !Array.isArray(stats.categoriesExplored)
          ? stats.categoriesExplored
          : {},
    },
  };
};

export const initializeProgress = () => {
  const existing = readStored();
  if (existing) {
    const progress = normalize(existing);
    // "Speed Reader" counts articles per browser session, so reset it on a new one.
    try {
      if (!sessionStorage.getItem('osint_session')) {
        sessionStorage.setItem('osint_session', '1');
        progress.stats.articlesReadThisSession = 0;
      }
    } catch { /* storage unavailable */ }
    return progress;
  }
  
  const initialProgress = {
    xp: 0,
    level: 1,
    achievements: [],
    stats: {
      articlesRead: 0,
      questionsAsked: 0,
      articlesShared: 0,
      sessionCount: 0,
      totalTimeSpent: 0,
      countriesExplored: [],
      categoriesExplored: {},
      breakingNewsRead: 0,
      currentStreak: 1,
      longestStreak: 1,
      lastLoginDate: new Date().toISOString()
    }
  };
  
  saveProgress(initialProgress);
  return initialProgress;
};

// Save progress to localStorage
export const saveProgress = (progress) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch { /* storage full or blocked: progress just won't persist */ }
};

// Load progress, apply a tracker, save, and tell UserProgress to refresh.
export const recordProgress = (tracker, ...args) => {
  const progress = readStored() ? normalize(readStored()) : initializeProgress();
  const tracked = tracker(progress, ...args);
  // Trackers chain awardXP + checkAchievements, which can lose the level-up flag.
  const result = {
    ...tracked,
    leveledUp: getLevelInfo(tracked.progress.xp).level > getLevelInfo(progress.xp).level,
  };
  saveProgress(result.progress);
  window.dispatchEvent(new CustomEvent('progressUpdate', { detail: result }));
  return result;
};

// Get current level info
export const getLevelInfo = (xp) => {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].minXP) {
      return LEVELS[i];
    }
  }
  return LEVELS[0];
};

// Get progress to next level
export const getProgressToNextLevel = (xp) => {
  const currentLevel = getLevelInfo(xp);
  if (currentLevel.level === 10) {
    return { percentage: 100, current: xp - currentLevel.minXP, needed: null, maxed: true };
  }
  
  const xpInCurrentLevel = xp - currentLevel.minXP;
  const xpNeededForNextLevel = currentLevel.maxXP - currentLevel.minXP;
  const percentage = (xpInCurrentLevel / xpNeededForNextLevel) * 100;
  
  return {
    percentage: Math.min(percentage, 100),
    current: xpInCurrentLevel,
    needed: xpNeededForNextLevel,
    nextLevel: LEVELS[currentLevel.level]
  };
};

// Award XP
export const awardXP = (progress, amount, reason) => {
  const oldLevel = getLevelInfo(progress.xp).level;
  const newXP = progress.xp + amount;
  const newLevel = getLevelInfo(newXP).level;
  
  const updatedProgress = {
    ...progress,
    xp: newXP,
    level: newLevel
  };
  
  saveProgress(updatedProgress);
  
  // Return level up info if applicable
  return {
    progress: updatedProgress,
    leveledUp: newLevel > oldLevel,
    oldLevel,
    newLevel,
    xpGained: amount,
    reason
  };
};

// Check and unlock achievements
export const checkAchievements = (progress) => {
  const newAchievements = [];
  
  ACHIEVEMENTS.forEach(achievement => {
    // Skip if already unlocked
    if (progress.achievements.includes(achievement.id)) return;
    
    let unlocked = false;
    
    switch (achievement.id) {
      case 'first_article':
        unlocked = progress.stats.articlesRead >= 1;
        break;
      case 'curious_mind':
        unlocked = progress.stats.questionsAsked >= 10;
        break;
      case 'news_junkie':
        unlocked = progress.stats.articlesRead >= 100;
        break;
      case 'week_streak':
        unlocked = progress.stats.currentStreak >= 7;
        break;
      case 'speed_reader':
        unlocked = progress.stats.articlesReadThisSession >= 10;
        break;
      case 'global_awareness':
        unlocked = progress.stats.countriesExplored.length >= 7;
        break;
      case 'category_master':
        unlocked = Object.values(progress.stats.categoriesExplored).some(count => count >= 50);
        break;
      case 'ai_whisperer':
        unlocked = progress.stats.questionsAsked >= 50;
        break;
      case 'breaking_hunter':
        unlocked = progress.stats.breakingNewsRead >= 20;
        break;
      case 'elite_analyst':
        unlocked = progress.level >= 10;
        break;
      default:
        break;
    }
    
    if (unlocked) {
      newAchievements.push(achievement);
    }
  });
  
  if (newAchievements.length > 0) {
    const updatedProgress = {
      ...progress,
      achievements: [...progress.achievements, ...newAchievements.map(a => a.id)]
    };
    
    // Award XP for achievements
    const totalAchievementXP = newAchievements.reduce((sum, a) => sum + a.xp, 0);
    const result = awardXP(updatedProgress, totalAchievementXP, 'Achievement unlocked');
    
    return {
      ...result,
      newAchievements
    };
  }
  
  return { progress, leveledUp: false, newAchievements: [] };
};

// Track article read
export const trackArticleRead = (progress, article) => {
  const updatedStats = {
    ...progress.stats,
    articlesRead: progress.stats.articlesRead + 1,
    articlesReadThisSession: (progress.stats.articlesReadThisSession || 0) + 1
  };
  
  // Track country
  if (article.country && !updatedStats.countriesExplored.includes(article.country)) {
    updatedStats.countriesExplored = [...updatedStats.countriesExplored, article.country];
  }
  
  // Track category
  if (article.category) {
    updatedStats.categoriesExplored = {
      ...updatedStats.categoriesExplored,
      [article.category]: (updatedStats.categoriesExplored[article.category] || 0) + 1
    };
  }
  
  // Track breaking news
  if (article.severity === 'Breaking') {
    updatedStats.breakingNewsRead = updatedStats.breakingNewsRead + 1;
  }
  
  const updatedProgress = {
    ...progress,
    stats: updatedStats
  };
  
  // Award XP
  const xpAmount = article.severity === 'Breaking' ? XP_REWARDS.BREAKING_NEWS_FIRST : XP_REWARDS.READ_ARTICLE;
  const result = awardXP(updatedProgress, xpAmount, 'Article read');
  
  // Check for achievements
  return checkAchievements(result.progress);
};

// Track Veritas question
export const trackVeritasQuestion = (progress) => {
  const updatedStats = {
    ...progress.stats,
    questionsAsked: progress.stats.questionsAsked + 1
  };
  
  const updatedProgress = {
    ...progress,
    stats: updatedStats
  };
  
  const result = awardXP(updatedProgress, XP_REWARDS.ASK_VERITAS, 'Veritas question');
  return checkAchievements(result.progress);
};

// Update daily streak
export const updateStreak = (progress) => {
  const today = new Date().toDateString();
  const lastLogin = new Date(progress.stats.lastLoginDate).toDateString();
  
  if (today === lastLogin) {
    return { progress, leveledUp: false, newAchievements: [] }; // Already logged in today
  }
  
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();
  
  let newStreak = progress.stats.currentStreak;
  
  if (lastLogin === yesterdayStr) {
    // Consecutive day
    newStreak += 1;
  } else {
    // Streak broken
    newStreak = 1;
  }
  
  const updatedStats = {
    ...progress.stats,
    currentStreak: newStreak,
    longestStreak: Math.max(newStreak, progress.stats.longestStreak),
    lastLoginDate: new Date().toISOString(),
    sessionCount: progress.stats.sessionCount + 1
  };
  
  const updatedProgress = {
    ...progress,
    stats: updatedStats
  };
  
  const result = awardXP(updatedProgress, XP_REWARDS.DAILY_LOGIN, 'Daily login');
  return checkAchievements(result.progress);
};

// Get all achievements
export const getAllAchievements = () => ACHIEVEMENTS;

// Get unlocked achievements
export const getUnlockedAchievements = (progress) => {
  return ACHIEVEMENTS.filter(a => progress.achievements.includes(a.id));
};

// Get locked achievements
export const getLockedAchievements = (progress) => {
  return ACHIEVEMENTS.filter(a => !progress.achievements.includes(a.id));
};

export { LEVELS, ACHIEVEMENTS, XP_REWARDS };
