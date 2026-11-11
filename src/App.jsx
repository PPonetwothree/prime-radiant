import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import { CategoryView, SourceView, RegionalOverview, Archive, Watchlist, VeritasBot, ArticleDetail, NotFound } from './pages';

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/category/:category" element={<CategoryView />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/sources" element={<SourceView />} />
          <Route path="/regional" element={<RegionalOverview />} />
          <Route path="/veritas" element={<VeritasBot />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/article/:id" element={<ArticleDetail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
