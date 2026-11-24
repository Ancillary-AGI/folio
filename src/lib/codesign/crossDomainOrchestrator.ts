export type DesignDomain = 'schematic' | 'pcb' | 'mechanical' | 'embedded' | 'robotics' | 'twin' | 'siem';

export interface CoDesignIssue {
  domain: DesignDomain;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface CoDesignSnapshot {
  id: string;
  projectId: string;
  domains: Partial<Record<DesignDomain, Record<string, unknown>>>;
  createdAt: number;
  issues: CoDesignIssue[];
  syncScore: number;
}

export class CrossDomainOrchestrator {
  private snapshots: CoDesignSnapshot[] = [];

  synchronize(projectId: string, domains: CoDesignSnapshot['domains']): CoDesignSnapshot {
    const issues: CoDesignIssue[] = [];
    const pcb = domains.pcb as { nets?: number; unrouted?: number } | undefined;
    const schematic = domains.schematic as { nets?: number } | undefined;
    const twin = domains.twin as { status?: string } | undefined;
    const siem = domains.siem as { alerts?: number } | undefined;

    if (schematic && pcb && typeof schematic.nets === 'number' && typeof pcb.nets === 'number' && schematic.nets !== pcb.nets) {
      issues.push({ domain: 'pcb', severity: 'error', message: 'Schematic net count does not match PCB nets' });
    }
    if (pcb && (pcb.unrouted ?? 0) > 0) {
      issues.push({ domain: 'pcb', severity: 'warning', message: `${pcb.unrouted} nets remain unrouted` });
    }
    if (twin?.status === 'offline') {
      issues.push({ domain: 'twin', severity: 'warning', message: 'Digital twin is offline; simulation is not synchronized' });
    }
    if ((siem?.alerts ?? 0) > 0) {
      issues.push({ domain: 'siem', severity: 'warning', message: `${siem?.alerts} cyber-physical alerts require review` });
    }

    const errorWeight = issues.filter((i) => i.severity === 'error').length * 25;
    const warnWeight = issues.filter((i) => i.severity === 'warning').length * 8;
    const snapshot: CoDesignSnapshot = {
      id: `cds_${Date.now()}`,
      projectId,
      domains,
      createdAt: Date.now(),
      issues,
      syncScore: Math.max(0, 100 - errorWeight - warnWeight),
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  latest(projectId: string): CoDesignSnapshot | undefined {
    return [...this.snapshots].reverse().find((s) => s.projectId === projectId);
  }
}

export const crossDomainOrchestrator = new CrossDomainOrchestrator();
