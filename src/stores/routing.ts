/**
 * Clean, History-API routes for the workbench.
 *
 * Folio stays a single SPA on purpose: schematics, routed boards, undo history,
 * agent sessions and WebGL contexts are live state shared by every workspace.
 * Splitting into separate documents would reload that state and duplicate the
 * vendor bundles. Routes therefore describe views inside one app, and heavy
 * workspaces stay code-split behind their existing lazy imports.
 *
 *   /                          project landing, or the open project's sheet
 *   /agents                    a workspace before a project is chosen
 *   /projects                  project list
 *   /projects/:id              that project's schematic
 *   /projects/:id/simulation   …and every other workspace
 *
 * URLs are server-independent. A static host must rewrite unknown paths to
 * `index.html`; the checked-in host configs provide that fallback. Legacy
 * `#/pcb?project=…` bookmarks are rewritten once on boot.
 */
import type { WorkspaceMode } from './useAppStore';

export const PROJECTS_ROUTE = '/projects';
/**
 * Administration is intentionally outside the workspace routes: it is not a
 * CAD mode and can be opened with or without a project loaded.
 */
export const ADMIN_ROUTE = '/admin';

/** True for the administration console path (trailing slash tolerated). */
export function isAdminPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === ADMIN_ROUTE;
}

export const WORKSPACE_ROUTES: Readonly<Record<WorkspaceMode, string>> = {
  schematic: '/',
  simulation: '/simulation',
  control: '/control',
  machines: '/machines',
  grid: '/grid',
  mechanical: '/cad',
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

const ROUTE_TO_MODE: Readonly<Record<string, WorkspaceMode>> = Object.fromEntries(
  Object.entries(WORKSPACE_ROUTES).map(([mode, route]) => [route, mode as WorkspaceMode]),
);

export interface LocationRoute {
  /** Workspace encoded by the URL, or null for the project list / unknown paths. */
  mode: WorkspaceMode | null;
  /** Project id from `/projects/:id/…` or the legacy `?project=` query. */
  projectId: string | null;
  /** True only for `/projects`. */
  isProjectList: boolean;
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
  return Object.prototype.hasOwnProperty.call(WORKSPACE_ROUTES, value);
}

/** Canonical path for a workspace, optionally scoped to a project. */
export function workspacePath(mode: WorkspaceMode, projectId?: string | null): string {
  const route = WORKSPACE_ROUTES[mode];
  if (!projectId) return route;
  const base = `${PROJECTS_ROUTE}/${encodeURIComponent(projectId)}`;
  return route === '/' ? base : `${base}${route}`;
}

/**
 * Parse a pathname (and the legacy `?project=` query) into a route.
 * Unknown paths return `mode: null` and no project so the caller can
 * normalise them instead of rendering an arbitrary panel.
 */
export function parseRoute(pathname: string, search = ''): LocationRoute {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === PROJECTS_ROUTE.slice(1)) {
    if (segments.length === 1) {
      return { mode: null, projectId: null, isProjectList: true };
    }
    const projectId = decodeSegment(segments[1]);
    if (segments.length === 2) {
      return { mode: 'schematic', projectId, isProjectList: false };
    }
    const mode = ROUTE_TO_MODE[`/${segments.slice(2).join('/')}`] ?? 'schematic';
    return { mode, projectId, isProjectList: false };
  }
  const mode = ROUTE_TO_MODE[`/${segments.join('/')}`] ?? null;
  if (!mode) return { mode: null, projectId: null, isProjectList: false };
  return {
    mode,
    projectId: new URLSearchParams(search).get('project') || null,
    isProjectList: false,
  };
}

/** The route described by the current address bar. */
export function currentRoute(): LocationRoute {
  if (typeof window === 'undefined') {
    return { mode: null, projectId: null, isProjectList: false };
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
