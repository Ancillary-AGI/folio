import { describe, expect, it, beforeEach, vi } from 'vitest';
import { vcsService, stableStringify, snapshotTreeHash } from './vcsService';

const snap = (n: number) => ({
  components: [{ id: `c${n}`, x: n }],
  wires: [{ id: `w${n}` }],
  code: `code${n}`,
  netlist: `net${n}`,
  simConfig: { f: n },
});

const largeSnapshot = () => ({
  components: Array.from({ length: 80 }, (_, index) => ({
    id: `c${index}`,
    x: index,
    y: index * 2,
    footprint: 'soic-8',
    pins: Array.from({ length: 8 }, (_, pin) => ({ pin, net: `N${pin}` })),
    notes: 'static payload '.repeat(8),
  })),
  wires: Array.from({ length: 60 }, (_, index) => ({
    id: `w${index}`,
    from: { x: index, y: 0 },
    to: { x: index, y: 20 },
    label: 'signal',
  })),
  code: 'const value = 42;\n'.repeat(600),
  netlist: '.subckt stage 1 2\n'.repeat(600),
  simConfig: { analysis: 'tran', stop: 1e-3 },
  meta: { viewport: { zoom: 1, pan: { x: 0, y: 0 } } },
});

const revision = (index: number) => {
  const snapshot = largeSnapshot();
  snapshot.components[7] = { ...snapshot.components[7], x: index };
  return snapshot;
};

describe('vcsService', () => {
  beforeEach(() => {
    vcsService.reset();
  });

  it('creates deterministic content-addressed commits', () => {
    const a = vcsService.commit('p1', 'first', snap(1), 'alice');
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
    expect(a.parents).toEqual([]);
    expect(a.treeHash).toBe(snapshotTreeHash(snap(1)));
    // identical tree -> same commit returned, no duplicate
    const a2 = vcsService.commit('p1', 'first again', snap(1), 'alice');
    expect(a2.id).toBe(a.id);
    const b = vcsService.commit('p1', 'second', snap(2), 'alice');
    expect(b.parents).toEqual([a.id]);
    expect(b.id).not.toBe(a.id);
  });

  it('keeps the routed board in commits and restores it intact', async () => {
    const layout = {
      widthMm: 40, heightMm: 20, thicknessMm: 1.6,
      layers: [{ id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000', visible: true, side: 'top' }],
      traces: [{ id: 't1', net: 'A', layerId: 'top-cu', widthMm: 0.2, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
      vias: [],
      components: [{ id: 'id-R1', reference: 'R1', footprint: '0805', x: 10, y: 10 }],
    };
    const first = vcsService.commit('p-layout', 'routed', { ...snap(1), pcbLayout: layout });
    vcsService.commit('p-layout', 'layout changed', { ...snap(1), pcbLayout: { ...layout, traces: [] } });
    expect(vcsService.checkout('p-layout', first.id).pcbLayout).toEqual(layout);

    vi.resetModules();
    const reloaded = await import('./vcsService');
    expect(reloaded.vcsService.checkout('p-layout', first.id).pcbLayout).toEqual(layout);
  });

  it('purges a deleted project without touching other repositories', async () => {
    vcsService.commit('keep', 'kept', snap(1));
    vcsService.commit('drop', 'secret history', snap(1));
    expect(vcsService.removeRepo('drop')).toBe(true);
    expect(vcsService.getRepo('drop')).toBeUndefined();
    expect(vcsService.log('drop')).toEqual([]);
    expect(vcsService.getRepo('keep')).toBeDefined();

    vi.resetModules();
    const reloaded = await import('./vcsService');
    expect(reloaded.vcsService.getRepo('drop')).toBeUndefined();
    expect(reloaded.vcsService.getRepo('keep')).toBeDefined();
    expect(localStorage.getItem('folio.vcs.v1')).not.toContain('secret history');
    expect(reloaded.vcsService.removeRepo('missing')).toBe(false);
  });

  it('logs, diffs, branches and merges', () => {
    const base = vcsService.commit('p2', 'base', snap(1));
    vcsService.createBranch('p2', 'feat');
    vcsService.switchBranch('p2', 'feat');
    const feat = vcsService.commit('p2', 'feat work', snap(2));
    expect(feat.parents).toEqual([base.id]);
    vcsService.switchBranch('p2', 'main');
    const main2 = vcsService.commit('p2', 'main work', { ...snap(1), code: 'main-code' });
    const merged = vcsService.merge('p2', 'feat');
    expect(merged.parents).toContain(main2.id);
    expect(merged.parents).toContain(feat.id);
    const log = vcsService.log('p2');
    expect(log[0].id).toBe(merged.id);
    const d = vcsService.diff('p2', base.id, feat.id);
    expect(d.some((e) => e.kind === 'added-component' && e.id === 'c2')).toBe(true);
    expect(d.some((e) => e.kind === 'removed-component' && e.id === 'c1')).toBe(true);
  });

  it('versions mechanical assemblies and every other CAD domain', async () => {
    const multidomain = {
      ...snap(1),
      pcbLayout: { widthMm: 40, heightMm: 20, traces: [], layers: [], vias: [], components: [] },
      mechanicalParts: [
        { id: 'beam-1', kind: 'beam', materialKey: 'aluminum', length: 2 },
        { id: 'plate-1', kind: 'plate', materialKey: 'steel', thickness: 2 },
      ],
      domains: {
        rf: { frequencyMHz: 2400, filterKind: 'lowpass' },
        control: { kp: 2, ki: 1, kd: 0.1 },
      },
    };
    const first = vcsService.commit('p-multi', 'multidomain base', multidomain);
    const revised = {
      ...multidomain,
      mechanicalParts: [
        { id: 'beam-1', kind: 'beam', materialKey: 'titanium', length: 2 },
        { id: 'plate-1', kind: 'plate', materialKey: 'steel', thickness: 3 },
      ],
      domains: {
        rf: { frequencyMHz: 5800, filterKind: 'lowpass' },
        visual: { nodes: [], edges: [] },
      },
    };
    const second = vcsService.commit('p-multi', 'revise', revised);

    const diff = vcsService.diff('p-multi', first.id, second.id);
    expect(diff).toContainEqual({ kind: 'modified-mechanical', id: 'beam-1' });
    expect(diff).toContainEqual({ kind: 'modified-mechanical', id: 'plate-1' });
    expect(diff).toContainEqual({ kind: 'modified-domain', id: 'rf' });
    expect(diff).toContainEqual({ kind: 'added-domain', id: 'visual' });
    expect(diff).toContainEqual({ kind: 'removed-domain', id: 'control' });
    expect(diff.some((entry) => entry.kind === 'initial')).toBe(false);

    // A branch changes RF and adds a machines domain; main changes the beam and
    // the board. The merge must carry both domains and both mechanical edits.
    vcsService.createBranch('p-multi', 'rf-work', first.id);
    vcsService.switchBranch('p-multi', 'rf-work');
    const rfBranch = vcsService.commit('p-multi', 'rf work', {
      ...multidomain,
      pcbLayout: { ...multidomain.pcbLayout, heightMm: 30 },
      domains: {
        rf: { frequencyMHz: 915, filterKind: 'lowpass' },
        control: { kp: 2, ki: 1, kd: 0.1 },
        machines: { family: 'bldc' },
      },
    });
    vcsService.switchBranch('p-multi', 'main');
    const mainWork = vcsService.commit('p-multi', 'mechanical work', {
      ...revised,
      mechanicalParts: revised.mechanicalParts.map((part) =>
        part.id === 'beam-1' ? { ...part, length: 2.5 } : part,
      ),
    });
    const merged = vcsService.merge('p-multi', 'rf-work');
    expect(merged.parents).toEqual([mainWork.id, rfBranch.id]);
    const mergedDomains = merged.snapshot.domains as Record<string, Record<string, unknown>>;
    expect(mergedDomains.machines).toEqual({ family: 'bldc' });
    // Both branches edited RF; ours (the checked-out branch) wins the conflict.
    expect(mergedDomains.rf).toEqual({ frequencyMHz: 5800, filterKind: 'lowpass' });
    expect(mergedDomains.control).toBeUndefined();
    expect(merged.snapshot.mechanicalParts).toContainEqual({
      id: 'beam-1', kind: 'beam', materialKey: 'titanium', length: 2.5,
    });
    expect((merged.snapshot.pcbLayout as { heightMm: number }).heightMm).toBe(30);

    const back = vcsService.checkout('p-multi', first.id);
    expect(back.mechanicalParts).toHaveLength(2);
    expect(back.domains).toEqual(multidomain.domains);
    expect((back.pcbLayout as { widthMm: number }).widthMm).toBe(40);

    vi.resetModules();
    const reloaded = await import('./vcsService');
    const persisted = reloaded.vcsService.checkout('p-multi', first.id);
    expect(persisted.mechanicalParts).toEqual(multidomain.mechanicalParts);
    expect(persisted.domains).toEqual(multidomain.domains);
    expect(reloaded.vcsService.getPersistenceError()).toBeNull();
    reloaded.vcsService.reset();
  });

  it('restores a past commit without rewriting branch history', () => {
    const a = vcsService.commit('p3', 'a', snap(1));
    const b = vcsService.commit('p3', 'b', snap(2));
    const back = vcsService.checkout('p3', a.id);
    expect(stableStringify(back.components)).toBe(stableStringify(snap(1).components));
    back.components.push({ id: 'scratch' });
    expect(vcsService.log('p3')[1].snapshot.components).toHaveLength(1);
    // A restore is a read: the newer commit stays on the branch and remains visible.
    expect(vcsService.log('p3').map((commit) => commit.id)).toEqual([b.id, a.id]);
    const restored = vcsService.commit('p3', 'restore a', back);
    expect(restored.parents).toEqual([b.id]);
    expect(vcsService.log('p3')[0].id).toBe(restored.id);
    const r = vcsService.revert('p3', a.id);
    expect(r.message).toContain('Revert');
    expect(r.parents).toEqual([restored.id]);
  });

  it('persists compact deltas and rehydrates exact snapshots', async () => {
    for (let index = 0; index < 12; index += 1) {
      vcsService.commit('p-delta', `revision ${index}`, revision(index));
    }
    const raw = localStorage.getItem('folio.vcs.v1');
    expect(raw).toBeTruthy();
    expect(raw).toContain('"delta"');
    expect(raw).not.toContain('"snapshot"');
    const naive = Array.from({ length: 12 }, (_, index) => JSON.stringify(revision(index)).length)
      .reduce((total, size) => total + size, 0);
    expect(raw!.length).toBeLessThan(naive * 0.25);

    vi.resetModules();
    const reloaded = await import('./vcsService');
    const fresh = reloaded.vcsService;
    const log = fresh.log('p-delta');
    expect(log).toHaveLength(12);
    expect(fresh.getPersistenceError()).toBeNull();
    for (let index = 0; index < 12; index += 1) {
      expect(stableStringify(log[11 - index].snapshot)).toBe(stableStringify(revision(index)));
      expect(log[11 - index].treeHash).toBe(snapshotTreeHash(revision(index)));
    }
    fresh.reset();
  });

  it('reports a storage quota failure instead of pretending history is durable', () => {
    const original = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'folio.vcs.v1') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return original.call(this, key, value);
    });
    try {
      const commit = vcsService.commit('p-quota', 'first', snap(1));
      expect(commit.parents).toEqual([]);
      expect(vcsService.getPersistenceError()).toMatch(/browser storage is full/i);
      expect(vcsService.log('p-quota')).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
    vcsService.commit('p-quota', 'second', snap(2));
    expect(vcsService.getPersistenceError()).toBeNull();
  });

  it('quarantines unreadable history and reports the loss', async () => {
    localStorage.setItem('folio.vcs.v1', '{"repo_broken":');
    vi.resetModules();
    const { vcsService: fresh } = await import('./vcsService');
    expect(fresh.log('anything')).toEqual([]);
    expect(fresh.getPersistenceError()).toMatch(/could not be read/i);
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '');
    expect(keys.some((key) => key.startsWith('folio.vcs.v1.corrupt.'))).toBe(true);
    fresh.reset();
  });

  it('reloads history written by another tab instead of overwriting it with stale memory', () => {
    vcsService.commit('p-tab', 'one', snap(1));
    const firstWrite = localStorage.getItem('folio.vcs.v1');
    expect(firstWrite).toBeTruthy();
    vcsService.commit('p-tab', 'two', snap(2));
    // Another tab writes the earlier history; the browser delivers a storage event.
    localStorage.setItem('folio.vcs.v1', firstWrite!);
    window.dispatchEvent(new StorageEvent('storage', { key: 'folio.vcs.v1' }));
    expect(vcsService.log('p-tab')).toHaveLength(1);
    expect(vcsService.head('p-tab')?.message).toBe('one');
  });

  it('reads v1 inline snapshots and upgrades them on the next write', async () => {
    const legacyTree = snapshotTreeHash(revision(0));
    localStorage.setItem('folio.vcs.v1', JSON.stringify({
      repo_legacy: {
        id: 'repo_legacy',
        projectId: 'legacy',
        branches: { main: { name: 'main', head: 'legacy-commit' } },
        currentBranch: 'main',
        commits: {
          'legacy-commit': {
            id: 'legacy-commit',
            repoId: 'repo_legacy',
            parents: [],
            treeHash: legacyTree,
            message: 'old history',
            author: 'alice',
            timestamp: 1,
            snapshot: revision(0),
          },
        },
        tags: {},
        createdAt: 1,
        updatedAt: 1,
      },
    }));
    vi.resetModules();
    const { vcsService: fresh } = await import('./vcsService');
    expect(fresh.log('legacy')).toHaveLength(1);
    expect(stableStringify(fresh.checkout('legacy', 'legacy-commit'))).toBe(stableStringify(revision(0)));
    fresh.commit('legacy', 'new work', revision(1));
    const stored = JSON.parse(localStorage.getItem('folio.vcs.v1')!) as {
      repo_legacy: { format: number; commits: Record<string, { full?: unknown; snapshot?: unknown; delta?: unknown }> };
    };
    expect(stored.repo_legacy.format).toBe(2);
    expect(stored.repo_legacy.commits['legacy-commit'].snapshot).toBeUndefined();
    expect(stored.repo_legacy.commits['legacy-commit'].full).toBeTruthy();
    expect(Array.isArray(stored.repo_legacy.commits[fresh.head('legacy')!.id].delta)).toBe(true);
    fresh.reset();
  });

  it('persists across instances via localStorage', async () => {
    vcsService.commit('p4', 'x', snap(1));
    const raw = localStorage.getItem('folio.vcs.v1');
    expect(raw).toContain('p4');
    expect(vcsService.log('p4').length).toBe(1);
    vi.resetModules();
    const { vcsService: fresh } = await import('./vcsService');
    expect(fresh.log('p4').length).toBe(1);
    expect(stableStringify(fresh.checkout('p4', fresh.log('p4')[0].id))).toBe(stableStringify(snap(1)));
    fresh.reset();
  });
});
