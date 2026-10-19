/**
 * Deep-linkable workspace URLs (hash routing — no server rewrite needed).
 *
 * `/` → schematic, `/#/pcb`, `/#/preview3d`, … plus `?project=` to restore a
 * saved project id. Back/forward buttons work; every tab is bookmarkable.
 * Lives in its own module so both the app store and the workspace can share
 * it without a circular import.
 */
import type { WorkspaceMode } from './useAppStore';

export const WORKSPACE_ROUTES: Readonly<Record<WorkspaceMode, string>> = {
  schematic: '/',
  simulation: '/simulation',
  mechanical: '/cad',
  pcb: '/pcb',
  convert: '/schematic-pcb',
  preview3d: '/3d',
  robotics: '/robotics',
  embedded: '/embedded',
  fpga: '/fpga',
  hil: '/hil',
  twin: '/twin',
  siem: '/siem',
  marketplace: '/marketplace',
  dashboard: '/dashboard',
  bom: '/bom',
};

const ROUTE_TO_MODE: Readonly<Record<string, WorkspaceMode>> = Object.fromEntries(
  Object.entries(WORKSPACE_ROUTES).map(([mode, route]) => [route, mode as WorkspaceMode]),
);

/** Workspace mode encoded in the current hash, or null when absent/unknown. */
export function modeFromHash(): WorkspaceMode | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  const path = hash.split('?')[0] || '/';
  return ROUTE_TO_MODE[path] ?? null;
}

/** Project id encoded in the current hash query, or null. */
export function projectFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const query = window.location.hash.split('?')[1] ?? '';
  const match = query.match(/(?:^|&)project=([^&]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Write mode (+ optional project) into the hash without a page reload. */
export function writeHash(mode: WorkspaceMode, projectId?: string | null): void {
  if (typeof window === 'undefined') return;
  const route = WORKSPACE_ROUTES[mode];
  const suffix = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
  const next = `#${route}${suffix}`;
  if (window.location.hash !== next) window.location.hash = next;
}
