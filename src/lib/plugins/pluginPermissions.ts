/**
 * Plugin permission gate — capability enforcement for the extension host.
 *
 * `types/plugins.ts` already defines the permission vocabulary and the
 * manager already records `manifest.permissions`, but nothing ever checks
 * them: any loaded plugin can register any tool, simulator, or exporter.
 * This module closes that hole. Every registration path takes the manifest's
 * declared permissions and the action's required permission; undeclared
 * actions throw with the plugin id, the action, and the missing permission.
 * Manifests themselves are validated (id format, semver, API version) so a
 * malformed marketplace entry fails at install, not at runtime.
 */
import { PLUGIN_PERMISSIONS, type PluginPermission } from '../../types/plugins';

export class PluginPermissionError extends Error {
  constructor(
    readonly pluginId: string,
    readonly action: string,
    readonly required: string,
  ) {
    super(`Plugin ${pluginId} attempted ${action} without permission ${required}.`);
    this.name = 'PluginPermissionError';
  }
}

/** Action → required permission. Anything unlisted is denied by default. */
const ACTION_PERMISSIONS: Record<string, PluginPermission> = {
  'registerTool': 'ui:panels',
  'registerComponent': 'write:components',
  'registerSimulation': 'simulate:circuit',
  'registerExport': 'export:circuit',
  'subscribe': 'system:events',
  'publish': 'system:events',
  'storage': 'system:storage',
  'readCircuit': 'read:circuit',
  'writeCircuit': 'write:circuit',
  'readSimulation': 'read:simulation',
  'fetch': 'network:fetch',
  'websocket': 'network:websocket',
  'fileRead': 'file:read',
  'fileWrite': 'file:write',
};

/** True when `declared` grants `action`. Unknown actions are denied. */
export function canPerform(declared: readonly string[], action: string): boolean {
  const required = ACTION_PERMISSIONS[action];
  if (!required) return false;
  return declared.includes(required);
}

/** Throw unless `declared` grants `action`. */
export function requirePermission(pluginId: string, declared: readonly string[] | undefined, action: string): void {
  const required = ACTION_PERMISSIONS[action];
  if (!required) throw new PluginPermissionError(pluginId, action, '(no permission grants this action)');
  if (!declared || !declared.includes(required)) {
    throw new PluginPermissionError(pluginId, action, required);
  }
}

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const PLUGIN_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Validate a plugin manifest. Returns failures; empty means installable. */
export function validateManifest(manifest: {
  id?: unknown; name?: unknown; version?: unknown; author?: unknown;
  entryPoint?: unknown; apiVersion?: unknown; permissions?: unknown;
}): string[] {
  const failures: string[] = [];
  if (typeof manifest.id !== 'string' || !PLUGIN_ID.test(manifest.id)) {
    failures.push('id must be lowercase alphanumeric with dashes');
  }
  if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0) {
    failures.push('name must be a non-empty string');
  }
  if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) {
    failures.push('version must be semver (x.y.z)');
  }
  if (typeof manifest.author !== 'string' || manifest.author.trim().length === 0) {
    failures.push('author must be a non-empty string');
  }
  if (typeof manifest.entryPoint !== 'string' || manifest.entryPoint.trim().length === 0) {
    failures.push('entryPoint must be a non-empty string');
  }
  if (typeof manifest.apiVersion !== 'string' || manifest.apiVersion.trim().length === 0) {
    failures.push('apiVersion must be a non-empty string');
  }
  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) {
      failures.push('permissions must be an array');
    } else {
      for (const p of manifest.permissions) {
        if (typeof p !== 'string' || !(p in PLUGIN_PERMISSIONS)) {
          failures.push(`unknown permission "${String(p)}"`);
        }
      }
    }
  }
  return failures;
}

/** True when every declared permission names a real capability. */
export function declaredPermissionsValid(declared: readonly string[]): boolean {
  return declared.every((p) => p in PLUGIN_PERMISSIONS);
}
