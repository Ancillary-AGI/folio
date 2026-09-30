import { describe, expect, it, beforeEach } from 'vitest';
import { vcsService, stableStringify, snapshotTreeHash } from './vcsService';

const snap = (n: number) => ({
  components: [{ id: `c${n}`, x: n }],
  wires: [{ id: `w${n}` }],
  code: `code${n}`,
  netlist: `net${n}`,
  simConfig: { f: n },
});

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

  it('checkouts and reverts', () => {
    const a = vcsService.commit('p3', 'a', snap(1));
    vcsService.commit('p3', 'b', snap(2));
    const back = vcsService.checkout('p3', a.id);
    expect(stableStringify(back.components)).toBe(stableStringify(snap(1).components));
    const r = vcsService.revert('p3', a.id);
    expect(r.message).toContain('Revert');
  });

  it('persists across instances via localStorage', () => {
    vcsService.commit('p4', 'x', snap(1));
    const raw = localStorage.getItem('folio.vcs.v1');
    expect(raw).toContain('p4');
    expect(vcsService.log('p4').length).toBe(1);
  });
});
