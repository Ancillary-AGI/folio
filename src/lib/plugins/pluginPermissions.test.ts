import { describe, expect, it } from 'vitest';
import { canPerform, declaredPermissionsValid, requirePermission, validateManifest } from './pluginPermissions';

describe('plugin permissions', () => {
  it('grants declared actions and denies everything else', () => {
    expect(canPerform(['simulate:circuit'], 'registerSimulation')).toBe(true);
    expect(canPerform(['simulate:circuit'], 'registerExport')).toBe(false);
    expect(canPerform([], 'registerTool')).toBe(false);
    expect(canPerform(['ui:panels'], 'nonexistent-action')).toBe(false);
  });
  it('throws naming the plugin, action, and missing permission', () => {
    expect(() => requirePermission('acme', ['read:circuit'], 'registerExport')).toThrow(/acme.*registerExport.*export:circuit/);
    expect(() => requirePermission('acme', undefined, 'registerTool')).toThrow(/ui:panels/);
    expect(() => requirePermission('acme', ['ui:panels'], 'registerTool')).not.toThrow();
  });
  it('validates manifests and rejects malformed ones', () => {
    const good = {
      id: 'acme-export', name: 'ACME', version: '1.2.3', author: 'ACME',
      entry: './index.js', apiVersion: '1', permissions: ['export:circuit'],
    };
    expect(validateManifest(good)).toEqual([]);
    expect(validateManifest({ ...good, id: 'BAD ID' })).toContain('id must be lowercase alphanumeric with dashes or dots');
    expect(validateManifest({ ...good, version: 'v1' })).toContain('version must be semver (x.y.z)');
    expect(validateManifest({ ...good, permissions: ['fly:moon'] })).toContain('unknown permission "fly:moon"');
    expect(validateManifest({ ...good, name: '' })).toContain('name must be a non-empty string');
  });
  it('checks declared permission lists against the vocabulary', () => {
    expect(declaredPermissionsValid(['read:circuit', 'export:circuit'])).toBe(true);
    expect(declaredPermissionsValid(['read:circuit', 'nope'])).toBe(false);
  });
});
