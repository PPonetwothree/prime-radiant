import React from 'react';
import { Link, useParams } from 'react-router-dom';
import Dashboard from './Dashboard';
import VeritasBot from './VeritasBot';
import { categoryBySlug } from '../constants';

const Placeholder = ({ title, children }) => (
  <div className="page-head placeholder">
    <h1>{title}</h1>
    <p className="page-sub">{children}</p>
    <p className="placeholder-note">This section is not yet in print.</p>
  </div>
);

// Category pages reuse the feed, filtered to that category.
export const CategoryView = () => {
  const { category } = useParams();
  const match = categoryBySlug(category);
  if (!match) return <NotFound />;
  return <Dashboard key={match.slug} category={match.name} title={match.name} />;
};

export { default as SourceView } from './Sources';
export { default as RegionalOverview } from './Regional';
export { default as Archive } from './Archive';
export { default as Watchlist } from './Watchlist';

export const ArticleDetail = () => (
  <Placeholder title="Article">Detailed view of a single report.</Placeholder>
);

export const NotFound = () => (
  <div className="page-head placeholder">
    <h1>Page not found</h1>
    <p className="page-sub">
      No such page. <Link to="/">Return to the front page</Link>.
    </p>
  </div>
);

export { VeritasBot };
