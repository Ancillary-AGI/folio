/**
 * The routes the public shell advertises.
 *
 * One list feeds the sitemap, robots.txt and the link-integrity test. The
 * workbench lives under `/app/*` (a catch-all), and the consoles are noindex,
 * so they are deliberately not crawler routes.
 */
export const PUBLIC_ROUTES = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/security', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/terms', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/privacy', changeFrequency: 'monthly', priority: 0.6 },
] as const

/** Routes reachable from the public shell but not advertised to crawlers. */
export const PRIVATE_ROUTES = [
  '/app',
  '/app/',
  '/console',
  '/admin',
] as const
