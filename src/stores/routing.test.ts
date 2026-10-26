import { beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_ROUTE,
  WORKSPACE_ROUTES,
  currentRoute,
  isAdminPath,
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

describe('workspace routing', () => {
  it('maps every mode to a distinct route', () => {
    const routes = Object.values(WORKSPACE_ROUTES);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('parses a standalone workspace path', () => {
    expect(parseRoute('/agents')).toEqual({
      mode: 'agents',
      projectId: null,
      isProjectList: false,
    });
    expect(parseRoute('/')).toEqual({
      mode: 'schematic',
      projectId: null,
      isProjectList: false,
    });
  });

  it('parses the project list and project-scoped workspaces', () => {
    expect(parseRoute('/projects')).toEqual({
      mode: null,
      projectId: null,
      isProjectList: true,
    });
    expect(parseRoute('/projects/p1')).toEqual({
      mode: 'schematic',
      projectId: 'p1',
      isProjectList: false,
    });
    expect(parseRoute('/projects/p1/pcb')).toEqual({
      mode: 'pcb',
      projectId: 'p1',
      isProjectList: false,
    });
  });

  it('accepts trailing slashes and unknown project workspaces', () => {
    expect(parseRoute('/projects/p1/')).toEqual({
      mode: 'schematic',
      projectId: 'p1',
      isProjectList: false,
    });
    expect(parseRoute('/projects/p1/not-a-workspace')).toEqual({
      mode: 'schematic',
      projectId: 'p1',
      isProjectList: false,
    });
  });

  it('round-trips project ids that need encoding', () => {
    const path = workspacePath('agents', 'folder/with space');
    expect(path).toBe('/projects/folder%2Fwith%20space/agents');
    expect(parseRoute(path)).toEqual({
      mode: 'agents',
      projectId: 'folder/with space',
      isProjectList: false,
    });
  });

  it('keeps the legacy ?project= query working', () => {
    expect(parseRoute('/pcb', '?project=abc')).toEqual({
      mode: 'pcb',
      projectId: 'abc',
      isProjectList: false,
    });
  });

  it('recognises the administration route without treating it as a workspace', () => {
    expect(ADMIN_ROUTE).toBe('/admin');
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/')).toBe(true);
    expect(isAdminPath('/admin/users')).toBe(false);
    expect(isAdminPath('/')).toBe(false);
    expect(parseRoute('/admin')).toEqual({
      mode: null,
      projectId: null,
      isProjectList: false,
    });
  });

  it('returns an unknown result for unrecognised paths', () => {
    window.history.replaceState(null, '', '/nope');
    expect(currentRoute()).toEqual({ mode: null, projectId: null, isProjectList: false });
    expect(parseRoute('/nope')).toEqual({
      mode: null,
      projectId: null,
      isProjectList: false,
    });
  });

  it('writes and reads the current location through the History API', () => {
    expect(window.location.pathname).toBe('/');
    writeWorkspaceRoute('preview3d', 'p1');
    expect(window.location.pathname).toBe('/projects/p1/3d');
    expect(window.location.hash).toBe('');
    expect(currentRoute()).toEqual({
      mode: 'preview3d',
      projectId: 'p1',
      isProjectList: false,
    });
    expect(projectIdFromLocation()).toBe('p1');

    writeWorkspaceRoute('schematic', null);
    expect(window.location.pathname).toBe('/');
    expect(projectIdFromLocation()).toBeNull();
  });

  it('does not touch history when the path is already canonical', () => {
    navigateTo('/projects/p1/bom');
    const length = window.history.length;
    navigateTo('/projects/p1/bom');
    expect(window.history.length).toBe(length);
  });

  it('rewrites a legacy hash bookmark onto its clean path', () => {
    window.history.replaceState(null, '', '/#/pcb?project=abc');
    normalizeLegacyUrl();
    expect(window.location.pathname).toBe('/projects/abc/pcb');
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('');

    window.history.replaceState(null, '', '/#/');
    normalizeLegacyUrl();
    expect(window.location.pathname).toBe('/');
  });
});
