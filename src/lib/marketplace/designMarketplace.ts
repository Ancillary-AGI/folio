export type MarketplaceCategory = 'schematic' | 'pcb' | 'mechanical' | 'robotics' | 'firmware' | 'fpga' | 'plugin';

export interface MarketplaceListing {
  id: string;
  title: string;
  author: string;
  category: MarketplaceCategory;
  description: string;
  version: string;
  license: string;
  tags: string[];
  downloads: number;
  rating: number;
  payload: Record<string, unknown>;
  publishedAt: number;
}

export class DesignMarketplace {
  private listings = new Map<string, MarketplaceListing>();
  private installed = new Map<string, MarketplaceListing>();
  private idSeq = 0;

  constructor() {
    this.seed();
  }

  private seed(): void {
    const samples: Array<Omit<MarketplaceListing, 'id' | 'publishedAt' | 'downloads'>> = [
      {
        title: 'Arduino Motor Driver Shield',
        author: 'Folio Labs',
        category: 'pcb',
        description: '2-layer PCB with DRV8833 dual H-bridge and current sense.',
        version: '1.2.0',
        license: 'CERN-OHL-S',
        tags: ['arduino', 'motor', 'robotics'],
        rating: 4.6,
        payload: { layers: 2, nets: 18 },
      },
      {
        title: '6-DOF Arm Digital Twin',
        author: 'MotionForge',
        category: 'robotics',
        description: 'URDF-inspired arm with IK sample trajectories.',
        version: '0.9.1',
        license: 'MIT',
        tags: ['twin', 'arm', 'ik'],
        rating: 4.4,
        payload: { joints: 6 },
      },
      {
        title: 'ISO 27001 Control Pack',
        author: 'SecureDesign',
        category: 'plugin',
        description: 'Compliance checklist plugin for cyber-physical projects.',
        version: '2.0.0',
        license: 'Apache-2.0',
        tags: ['siem', 'compliance'],
        rating: 4.8,
        payload: { controls: 14 },
      },
    ];
    samples.forEach((sample) => this.publish(sample));
  }

  publish(input: Omit<MarketplaceListing, 'id' | 'publishedAt' | 'downloads'> & { downloads?: number }): MarketplaceListing {
    const listing: MarketplaceListing = {
      ...input,
      id: `mkt_${Date.now()}_${++this.idSeq}`,
      downloads: input.downloads ?? 0,
      publishedAt: Date.now(),
    };
    this.listings.set(listing.id, listing);
    return listing;
  }

  search(query = '', category?: MarketplaceCategory): MarketplaceListing[] {
    const q = query.toLowerCase();
    return Array.from(this.listings.values()).filter((item) => {
      const matchesQuery =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.tags.some((t) => t.includes(q)) ||
        item.description.toLowerCase().includes(q);
      const matchesCategory = !category || item.category === category;
      return matchesQuery && matchesCategory;
    });
  }

  install(id: string): MarketplaceListing | undefined {
    const listing = this.listings.get(id);
    if (!listing) return undefined;
    listing.downloads += 1;
    this.installed.set(id, listing);
    return listing;
  }

  getInstalled(): MarketplaceListing[] {
    return Array.from(this.installed.values());
  }
}

export const designMarketplace = new DesignMarketplace();
