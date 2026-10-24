/**
 * Plugin & Extension Marketplace Service (plugin packages with permission
 * enforcement). For shippable design bundles (schematic + PCB + firmware)
 * see `designMarketplace.ts` — that module owns design listings, this one
 * owns installable plugin packages. The two registries are intentionally
 * separate; `MarketplacePanel` currently drives design bundles.
 */

import type { PluginManifest } from '../../types/plugins';
import { validateManifest, requirePermission } from '../plugins/pluginPermissions';

export interface MarketplaceEntry {
  id: string;
  manifest: PluginManifest;
  author: string;
  isVerifiedPublisher: boolean;
  downloadsCount: number;
  rating: number; // 0.0 to 5.0
  tags: string[];
  packagePayload: {
    tools?: Array<{ name: string; description: string }>;
    components?: Array<{ name: string; category: string }>;
  };
}

export class MarketplaceService {
  private readonly registry = new Map<string, MarketplaceEntry>();
  private readonly installed = new Map<string, MarketplaceEntry>();

  registerPackage(entry: MarketplaceEntry): void {
    const failures = validateManifest(entry.manifest);
    if (failures.length > 0) {
      throw new Error(`Invalid plugin manifest ${entry.id}: ${failures.join('; ')}.`);
    }
    this.registry.set(entry.id, entry);
  }

  listPackages(filterCategory?: string): MarketplaceEntry[] {
    const list = [...this.registry.values()];
    if (!filterCategory) return list;
    return list.filter((p) => p.manifest.category === filterCategory || p.tags.includes(filterCategory));
  }

  getPackage(id: string): MarketplaceEntry | undefined {
    return this.registry.get(id);
  }

  isInstalled(id: string): boolean {
    return this.installed.has(id);
  }

  installPackage(id: string): { success: boolean; activatedToolsCount: number } {
    const entry = this.registry.get(id);
    if (!entry) throw new Error(`Marketplace package ${id} not found.`);

    // Check permissions
    if (entry.packagePayload.tools && entry.packagePayload.tools.length > 0) {
      requirePermission(entry.id, entry.manifest.permissions, 'registerTool');
    }
    if (entry.packagePayload.components && entry.packagePayload.components.length > 0) {
      requirePermission(entry.id, entry.manifest.permissions, 'registerComponent');
    }

    this.installed.set(id, entry);
    entry.downloadsCount += 1;

    return {
      success: true,
      activatedToolsCount: entry.packagePayload.tools?.length ?? 0,
    };
  }

  uninstallPackage(id: string): boolean {
    return this.installed.delete(id);
  }

  listInstalled(): MarketplaceEntry[] {
    return [...this.installed.values()];
  }
}

export const marketplaceService = new MarketplaceService();
