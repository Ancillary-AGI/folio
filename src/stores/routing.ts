/**
 * Clean, History-API routes for the workbench.
 *
 * Folio stays a single SPA on purpose: schematics, routed boards, undo history,
 * agent sessions and WebGL contexts are live state shared by every workspace.
 * Splitting into separate documents would reload that state and duplicate the
 * vendor bundles. Routes therefore describe views inside one app, and heavy
 * workspaces stay code-split behind their existing lazy imports.
 *
 *   /app                      the project landing, or the open project's sheet
 *   /app/simulation           a workspace before a project is chosen
 *   /app/demos/:demoId        a gallery demo, opened on a fresh document
 *   /app/projects             project list
 *   /app/projects/:id         that project's schematic
 *   /app/projects/:id/pcb      …and every other workspace
 *   /app/community            community designs — search, open, publish
 *
 * The product lives under /app so the site root can be the marketing site
 * served from landing.html. URLs are server-independent. A static host must
 * rewrite unknown paths to `index.html`; the checked-in host configs provide
 * that fallback for /app/*. Legacy `#/pcb?project=…` bookmarks are rewritten
 * once on boot, and un-prefixed legacy paths redirect to /app.
 */
import type { WorkspaceMode } from './useAppStore';

export const APP_BASE = '/app';
export const PROJECTS_ROUTE = `${APP_BASE}/projects`;
export const COMMUNITY_ROUTE = `${APP_BASE}/community`;

/** Internal (unprefixed) mode→path pairs; APP_ROUTES prefixes them. */
const INTERNAL_WORKSPACE_ROUTES: Readonly<Record<WorkspaceMode, string>> = {
  schematic: '/',
  simulation: '/simulation',
  control: '/control',
  machines: '/machines',
  grid: '/grid',
  mechanical: '/cad',
  structures: '/structures',
  biology: '/biology',
  pcb: '/pcb',
  rf: '/rf',
  convert: '/schematic-pcb',
  preview3d: '/3d',
  robotics: '/robotics',
  embedded: '/embedded',
  imaging: '/imaging',
  visual: '/visual',
  fpga: '/fpga',
  hil: '/hil',
  twin: '/twin',
  siem: '/siem',
  marketplace: '/marketplace',
  dashboard: '/dashboard',
  bom: '/bom',
  hdl: '/hdl',
  icdesign: '/icdesign',
  agents: '/agents',
  components: '/components',
  plugins: '/plugins',
};

export const WORKSPACE_ROUTES: Readonly<Record<WorkspaceMode, string>> = Object.fromEntries(
  Object.entries(INTERNAL_WORKSPACE_ROUTES).map(([mode, route]) => [
    mode,
    route === '/' ? APP_BASE : `${APP_BASE}${route}`,
  ]),
) as Record<WorkspaceMode, string>;

const ROUTE_TO_MODE: Readonly<Record<string, WorkspaceMode>> = Object.fromEntries(
  Object.entries(INTERNAL_WORKSPACE_ROUTES).map(([mode, route]) => [route, mode as WorkspaceMode]),
);

export interface LocationRoute {
  /** Workspace encoded by the URL, or null for the project list / unknown paths. */
  mode: WorkspaceMode | null;
  /** Project id from `/app/projects/:id/…` or the legacy `?project=` query. */
  projectId: string | null;
  /** Demo id from `/app/demos/:demoId`, or null when the path is not a demo. */
  demoId: string | null;
  /** True only for `/app/projects`. */
  isProjectList: boolean;
  /** True only for `/app/community`. */
  isCommunity: boolean;
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** True when a string is a defined workspace mode. */
export function isWorkspaceMode(value: string): value is WorkspaceMode {
  return Object.prototype.hasOwnProperty.call(INTERNAL_WORKSPACE_ROUTES, value);
}

/** Canonical path for a workspace, optionally scoped to a project. */
export function workspacePath(mode: WorkspaceMode, projectId?: string | null): string {
  const route = WORKSPACE_ROUTES[mode];
  if (!projectId) return route;
  const base = `${PROJECTS_ROUTE}/${encodeURIComponent(projectId)}`;
  return route === APP_BASE ? base : `${base}${route.slice(APP_BASE.length)}`;
}

/**
 * Parse a pathname (and the legacy `?project=` query) into a route.
 * Unknown paths return `mode: null`, no project and no demo id so the caller
 * can normalise them instead of rendering an arbitrary panel.
 */
export function parseRoute(pathname: string, search = ''): LocationRoute {
  const segments = pathname.split('/').filter(Boolean);
  // The product lives under APP_BASE; everything else is not ours to route.
  if (segments[0] !== APP_BASE.slice(1)) {
    return { mode: null, projectId: null, demoId: null, isProjectList: false, isCommunity: false };
  }
  const rest = segments.slice(1);
  if (rest[0] === 'community' && rest.length === 1) {
    return { mode: null, projectId: null, demoId: null, isProjectList: false, isCommunity: true };
  }
  if (rest[0] === 'demos' && rest.length === 2) {
    // `/app/demos/:demoId` opens a gallery demo on a fresh document — the
    // marketing site's “Open a demo” CTA lands here. Unknown ids canonicalise
    // to the list at the caller.
    return { mode: null, projectId: null, demoId: decodeSegment(rest[1]), isProjectList: false, isCommunity: false };
  }
  if (rest[0] === 'projects') {
    if (rest.length === 1) {
      return { mode: null, projectId: null, demoId: null, isProjectList: true, isCommunity: false };
    }
    const projectId = decodeSegment(rest[1]);
    if (rest.length === 2) {
      return { mode: 'schematic', projectId, demoId: null, isProjectList: false, isCommunity: false };
    }
    const mode = ROUTE_TO_MODE[`/${rest.slice(2).join('/')}`] ?? 'schematic';
    return { mode, projectId, demoId: null, isProjectList: false, isCommunity: false };
  }
  const mode = ROUTE_TO_MODE[`/${rest.join('/')}`] ?? null;
  if (!mode) return { mode: null, projectId: null, demoId: null, isProjectList: false, isCommunity: false };
  return {
    mode,
    projectId: new URLSearchParams(search).get('project') || null,
    demoId: null,
    isProjectList: false,
    isCommunity: false,
  };
}

/** The route described by the current address bar. */
export function currentRoute(): LocationRoute {
  if (typeof window === 'undefined') {
    return { mode: null, projectId: null, demoId: null, isProjectList: false, isCommunity: false };
  }
  return parseRoute(window.location.pathname, window.location.search);
}

/** Project id in the current URL, or null. */
export function projectIdFromLocation(): string | null {
  return currentRoute().projectId;
}

/**
 * Write a path without a page reload. `replace` is for canonicalisation /
 * redirects; navigation that a user should be able to undo uses pushState.
 */
export function navigateTo(path: string, options: { replace?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === path) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
}

/** Write the canonical URL for a workspace (+ project) if it changed. */
export function writeWorkspaceRoute(
  mode: WorkspaceMode,
  projectId?: string | null,
  options: { replace?: boolean } = {},
): void {
  navigateTo(workspacePath(mode, projectId), options);
}

/** Subscribe to back/forward navigation. Returns the unsubscribe function. */
export function subscribeToRoute(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

/**
 * Rewrite a pre-clean-URL `#/…?project=…` bookmark onto its path equivalent.
 * Runs once before the app mounts, so the router never sees two URL formats.
 */
export function normalizeLegacyUrl(): void {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash;
  if (!hash.startsWith('#/')) return;
  const [path, query = ''] = hash.slice(1).split('?');
  const mode = ROUTE_TO_MODE[path] ?? null;
  const projectId = new URLSearchParams(query).get('project') || null;
  const target = mode
    ? workspacePath(mode, projectId)
    : projectId
      ? `${PROJECTS_ROUTE}/${encodeURIComponent(projectId)}`
      : PROJECTS_ROUTE;
  window.history.replaceState(null, '', target);
}
