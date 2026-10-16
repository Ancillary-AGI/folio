import { describe, expect, it } from 'vitest';
import { WORKSPACE_ROUTES, modeFromHash, projectFromHash, writeHash } from '../stores/routing';

describe('workspace routing', () => {
  it('maps every mode to a distinct route and back', () => {
    const routes = Object.values(WORKSPACE_ROUTES);
    expect(new Set(routes).size).toBe(routes.length);
  });
  it('reads mode + project from the hash and writes them back', () => {
    window.location.hash = '#/pcb?project=abc';
    expect(modeFromHash()).toBe('pcb');
    expect(projectFromHash()).toBe('abc');
    writeHash('preview3d', 'p1');
    expect(window.location.hash).toBe('#/3d?project=p1');
    writeHash('schematic', null);
    expect(window.location.hash).toBe('#/');
  });
  it('returns null for unknown routes', () => {
    window.location.hash = '#/nope';
    expect(modeFromHash()).toBeNull();
  });
});
