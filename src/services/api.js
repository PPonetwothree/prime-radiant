import axios from 'axios';

// Same-origin by default: the bundled server (server/index.js) serves both the
// site and /api. Set REACT_APP_API_URL only if the API lives elsewhere.
const API_URL = import.meta.env.REACT_APP_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Unwrap the response body so callers get the JSON directly.
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (!axios.isCancel(error)) console.error('API Error:', error?.message || error);
    return Promise.reject(error);
  }
);

export const articlesAPI = {
  getArticles: (params, config) => api.get('/articles', { params, ...config }),
  getArticleById: (id) => api.get(`/articles/${id}`),
  getBreakingNews: () => api.get('/articles/breaking/latest'),
  getStats: () => api.get('/articles/stats/overview'),
  getSources: () => api.get('/articles/meta/sources'),
};

export const archiveAPI = {
  search: (params, config) => api.get('/archive', { params, ...config }),
  trends: (days = 14) => api.get('/trends', { params: { days } }),
  sources: () => api.get('/sources'),
};

export const watchlistAPI = {
  list: () => api.get('/watchlist'),
  create: (rule) => api.post('/watchlist', rule),
  update: (id, changes) => api.patch(`/watchlist/${id}`, changes),
  remove: (id) => api.delete(`/watchlist/${id}`),
  testTelegram: () => api.post('/watchlist/telegram-test'),
  alerts: (params) => api.get('/alerts', { params }),
  count: () => api.get('/alerts/count'),
  markRead: (body) => api.post('/alerts/read', body),
};

export const veritasAPI = {
  generateTLDR: (articleId) => api.post('/veritas/tldr', { articleId }),
  askQuestion: (question, conversationHistory = []) =>
    api.post('/veritas/ask', { question, conversationHistory }),
  analyzeImpact: (sourceCountry, targetCountry) =>
    api.post('/veritas/analyze-impact', { sourceCountry, targetCountry }),
  connectEvents: (countries = [], categories = [], timeframe = '24hours') =>
    api.post('/veritas/connect-events', { countries, categories, timeframe }),
  getSuggestions: () => api.get('/veritas/suggestions'),
};

// The backend's response shape isn't documented; accept the common forms.
export const pickText = (res, ...keys) => {
  if (typeof res === 'string') return res;
  for (const src of [res, res?.data]) {
    if (!src || typeof src !== 'object') continue;
    for (const k of keys) if (typeof src[k] === 'string' && src[k].trim()) return src[k];
  }
  return null;
};

export const pickList = (res) => {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.articles)) return res.articles;
  if (Array.isArray(res?.data?.articles)) return res.data.articles;
  return [];
};

export default api;
