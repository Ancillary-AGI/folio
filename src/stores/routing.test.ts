import { beforeEach, describe, expect, it } from 'vitest';
import {
  WORKSPACE_ROUTES,
  COMMUNITY_ROUTE,
  APP_BASE,
  currentRoute,
  normalizeLegacyUrl,
  navigateTo,
  parseRoute,
  projectIdFromLocation,
  workspacePath,
  writeWorkspaceRoute,
} from './routing';

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('workspace routing under /app', () => {
  it('maps every mode to a distinct route', () => {
    const routes = Object.values(WORKSPACE_ROUTES);
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) expect(route.startsWith('/app')).toBe(true);
  });

  it('parses a standalone workspace path', () => {
    expect(parseRoute('/app/agents')).toEqual({
      mode: 'agents',
      projectId: null,
      isProjectList: false,
      isCommunity: false,
    });
    expect(parseRoute('/app')).toEqual({
      mode: 'schematic',
      projectId: null,
      isProjectList: false,
      isCommunity: false,
    });
  });

  it('is not confused by the website at the root', () => {
    expect(parseRoute('/')).toEqual({
      mode: null,
      projectId: null,
      isProjectList: false,
      isCommunity: false,
    });
    expect(parseRoute('/pricing')).toEqual({
      mode: null,
      projectId: null,
      isProjectList: false,
      isCommunity: false,
    });
    expect(parseRoute('/agents')).toEqual({
      mode: null,
      projectId: null,
      isProjectList: false,
      isCommunity: false,
    });
  });

  it('parses the dedicated community page', () => {
    expect(COMMUNITY_ROUTE).toBe('/app/community');
    expect(parseRoute('/app/community')).toEqual({
      mode: null,
      projectId: null,
      isProjectList: false,
      isCommunity: true,
    });
    expect(parseRoute('/app/community/')).toEqual({
      mode: null,
      projectId: null,
      isProjectList: false,
      isCommunity: true,
    });
  });

  it('parses the project list and project-scoped workspaces', () => {
    expect(parseRoute('/app/projects')).toEqual({
      mode: null,
      projectId: null,
      isProjectList: true,
      isCommunity: false,
    });
    expect(parseRoute('/app/projects/p1')).toEqual({
      mode: 'schematic',
      projectId: 'p1',
      isProjectList: false,
      isCommunity: false,
    });
    expect(parseRoute('/app/projects/p1/pcb')).toEqual({
      mode: 'pcb',
      projectId: 'p1',
      isProjectList: false,
      isCommunity: false,
    });
  });

  it('accepts trailing slashes and unknown project workspaces', () => {
    expect(parseRoute('/app/projects/p1/')).toEqual({
      mode: 'schematic',
      projectId: 'p1',
      isProjectList: false,
      isCommunity: false,
    });
    expect(parseRoute('/app/projects/p1/not-a-workspace')).toEqual({
      mode: 'schematic',
      projectId: 'p1',
      isProjectList: false,
      isCommunity: false,
    });
  });

  it('round-trips project ids that need encoding', () => {
    const path = workspacePath('agents', 'folder/with space');
    expect(path).toBe('/app/projects/folder%2Fwith%20space/agents');
    expect(parseRoute(path)).toEqual({
      mode: 'agents',
      projectId: 'folder/with space',
      isProjectList: false,
      isCommunity: false,
    });
  });

  it('keeps the legacy ?project= query working under the base', () => {
    expect(parseRoute('/app/pcb', '?project=abc')).toEqual({
      mode: 'pcb',
      projectId: 'abc',
      isProjectList: false,
      isCommunity: false,
    });
  });

  it('has no administration route: the operator console is a separate document', () => {
    // `/admin` is served as admin.html by the host, not by this SPA. If the
    // workbench ever claims it again, a designer's bundle would contain the
    // console — which is the boundary this asserts.
    expect(parseRoute('/app/admin')).toEqual({
      mode: null,
      projectId: null,
      isProjectList: false,
      isCommunity: false,
    });
    expect(Object.values(WORKSPACE_ROUTES)).not.toContain('/app/admin');
  });

  it('returns an unknown result for unrecognised paths', () => {
    window.history.replaceState(null, '', '/nope');
    expect(currentRoute()).toEqual({ mode: null, projectId: null, isProjectList: false, isCommunity: false });
    expect(parseRoute('/nope')).toEqual({
      mode: null,
      projectId: null,
      isProjectList: false,
      isCommunity: false,
    });
  });

  it('writes and reads the current location through the History API', () => {
    expect(window.location.pathname).toBe('/');
    writeWorkspaceRoute('preview3d', 'p1');
    expect(window.location.pathname).toBe('/app/projects/p1/3d');
    expect(window.location.hash).toBe('');
    expect(currentRoute()).toEqual({
      mode: 'preview3d',
      projectId: 'p1',
      isProjectList: false,
      isCommunity: false,
    });
    expect(projectIdFromLocation()).toBe('p1');

    writeWorkspaceRoute('schematic', null);
    expect(window.location.pathname).toBe('/app');
    expect(projectIdFromLocation()).toBeNull();
  });

  it('writes /app/community to the address bar without a project', () => {
    navigateTo(COMMUNITY_ROUTE);
    expect(window.location.pathname).toBe('/app/community');
    expect(currentRoute().isCommunity).toBe(true);
    expect(projectIdFromLocation()).toBeNull();
  });

  it('does not touch history when the path is already canonical', () => {
    navigateTo('/app/projects/p1/bom');
    const length = window.history.length;
    navigateTo('/app/projects/p1/bom');
    expect(window.history.length).toBe(length);
  });

  it('rewrites a legacy hash bookmark onto its clean path', () => {
    window.history.replaceState(null, '', '/#/pcb?project=abc');
    normalizeLegacyUrl();
    expect(window.location.pathname).toBe('/app/projects/abc/pcb');
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('');

    window.history.replaceState(null, '', '/#/');
    normalizeLegacyUrl();
    expect(window.location.pathname).toBe('/app');
  });

  it('exposes the product base it serves', () => {
    expect(APP_BASE).toBe('/app');
    expect(WORKSPACE_ROUTES.schematic).toBe('/app');
    expect(workspacePath('schematic', null)).toBe('/app');
  });
});
