// Shared lists so the sidebar, filters and routes stay in sync.

export const COUNTRIES = [
  'Pakistan',
  'China',
  'Bangladesh',
  'Myanmar',
  'Nepal',
  'Bhutan',
  'Afghanistan',
];

export const CATEGORIES = [
  { name: 'Military & Defense', slug: 'military-defense' },
  { name: 'Internal Affairs', slug: 'internal-affairs' },
  { name: 'Foreign Policy', slug: 'foreign-policy' },
  { name: 'Security and Conflicts', slug: 'security-conflicts' },
  { name: 'Economics and Trade', slug: 'economics-trade' },
  { name: 'Infrastructure', slug: 'infrastructure' },
];

export const categoryBySlug = (slug) => CATEGORIES.find((c) => c.slug === slug);

export const toClassName = (value = '') =>
  String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
