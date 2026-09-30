/**
 * VCS Service - real content-addressed version control for designs.
 * Git-like, local-first: repo per projectId, persisted to localStorage.
 * commit = { id sha256, parents[], treeHash, message, author, timestamp, snapshot }
 */

export interface VcsSnapshot {
  components: unknown[];
  wires: unknown[];
  code?: string | null;
  netlist?: string | null;
  simConfig?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

export interface VcsCommit {
  id: string;
  repoId: string;
  parents: string[];
  treeHash: string;
  message: string;
  author: string;
  timestamp: number;
  snapshot: VcsSnapshot;
}

export interface VcsBranch {
  name: string;
  head: string | null;
}

export interface VcsRepo {
  id: string;
  projectId: string;
  branches: Record<string, VcsBranch>;
  currentBranch: string;
  commits: Record<string, VcsCommit>;
  tags: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface VcsDiffEntry {
  kind: 'added-component' | 'removed-component' | 'modified-component' | 'added-wire' | 'removed-wire' | 'modified-wire' | 'code-changed' | 'netlist-changed' | 'simconfig-changed';
  id?: string;
  detail?: string;
}

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') {
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}


function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const bitLen = bytes.length * 8;
  const withPad = ((bytes.length + 8) >> 6) + 1;
  const padded = new Uint8Array(withPad * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296), false);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const hex = (x: number): string => (x >>> 0).toString(16).padStart(8, '0');
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

export function snapshotTreeHash(snapshot: VcsSnapshot): string {
  return sha256Hex(`tree:${stableStringify(snapshot)}`);
}

export function commitIdFor(repoId: string, parents: string[], tree: string, msg: string, author: string, ts: number): string {
  return sha256Hex(`commit:${repoId}:${stableStringify(parents)}:${tree}:${msg}:${author}:${ts}`);
}

const VCS_STORAGE_KEY = 'folio.vcs.v1';

function loadRepos(): Record<string, VcsRepo> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(VCS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, VcsRepo>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveRepos(repos: Record<string, VcsRepo>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(VCS_STORAGE_KEY, JSON.stringify(repos));
  } catch {
    /* quota exceeded: memory copy survives session */
  }
}

function compKey(c: unknown): string {
  const o = c as { id?: string };
  return String(o?.id ?? stableStringify(c));
}

function wireKey(w: unknown): string {
  const o = w as { id?: string };
  return String(o?.id ?? stableStringify(w));
}


class VcsService {
  private repos: Record<string, VcsRepo> = loadRepos();

  private persist(): void {
    for (const r of Object.values(this.repos)) r.updatedAt = Date.now();
    saveRepos(this.repos);
  }

  initRepo(projectId: string): VcsRepo {
    if (!projectId.trim()) throw new Error('projectId is required');
    const id = `repo_${projectId.trim()}`;
    const existing = this.repos[id];
    if (existing) return existing;
    const now = Date.now();
    const repo: VcsRepo = {
      id, projectId: projectId.trim(),
      branches: { main: { name: 'main', head: null } },
      currentBranch: 'main', commits: {}, tags: {},
      createdAt: now, updatedAt: now,
    };
    this.repos[id] = repo;
    this.persist();
    return repo;
  }

  getRepo(projectId: string): VcsRepo | undefined {
    return this.repos[`repo_${projectId}`];
  }

  head(projectId: string, branch?: string): VcsCommit | null {
    const repo = this.getRepo(projectId);
    if (!repo) return null;
    const b = repo.branches[branch ?? repo.currentBranch];
    if (!b?.head) return null;
    return repo.commits[b.head] ?? null;
  }

  reset(): void {
    this.repos = {};
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(VCS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  commit(projectId: string, message: string, snapshot: VcsSnapshot, author = 'local-user'): VcsCommit {
    if (!message.trim()) throw new Error('Commit message is required');
    const repo = this.initRepo(projectId);
    const branch = repo.branches[repo.currentBranch];
    const parents = branch.head ? [branch.head] : [];
    const treeHash = snapshotTreeHash(snapshot);
    if (branch.head) {
      const hc = repo.commits[branch.head];
      if (hc && hc.treeHash === treeHash) return hc;
    }
    const timestamp = Date.now();
    const id = commitIdFor(repo.id, parents, treeHash, message.trim(), author, timestamp);
    const clone = JSON.parse(stableStringify(snapshot)) as VcsSnapshot;
    const commit: VcsCommit = { id, repoId: repo.id, parents, treeHash, message: message.trim(), author, timestamp, snapshot: clone };
    repo.commits[id] = commit;
    branch.head = id;
    this.persist();
    return commit;
  }

  log(projectId: string, limit = 50): VcsCommit[] {
    const repo = this.getRepo(projectId);
    if (!repo) return [];
    const out: VcsCommit[] = [];
    let cur = repo.branches[repo.currentBranch]?.head ?? null;
    const seen = new Set<string>();
    while (cur && out.length < limit && !seen.has(cur)) {
      seen.add(cur);
      const c = repo.commits[cur];
      if (!c) break;
      out.push(c);
      cur = c.parents[0] ?? null;
    }
    return out;
  }

  status(projectId: string, snapshot: VcsSnapshot): VcsDiffEntry[] {
    const h = this.head(projectId);
    if (!h) return [{ kind: 'netlist-changed', detail: 'initial commit pending' }];
    return this.diffSnapshots(h.snapshot, snapshot);
  }

  diff(projectId: string, fromId: string, toId: string): VcsDiffEntry[] {
    const repo = this.getRepo(projectId);
    if (!repo) throw new Error('Repository not found');
    const from = repo.commits[fromId];
    const to = repo.commits[toId];
    if (!from || !to) throw new Error('Unknown commit id');
    return this.diffSnapshots(from.snapshot, to.snapshot);
  }
  diffSnapshots(from: VcsSnapshot, to: VcsSnapshot): VcsDiffEntry[] {
    const out: VcsDiffEntry[] = [];
    const fComps = new Map((from.components ?? []).map((c) => [compKey(c), c]));
    const tComps = new Map((to.components ?? []).map((c) => [compKey(c), c]));
    for (const [k, c] of tComps) {
      if (!fComps.has(k)) out.push({ kind: 'added-component', id: k });
      else if (stableStringify(fComps.get(k)) !== stableStringify(c)) out.push({ kind: 'modified-component', id: k });
    }
    for (const k of fComps.keys()) if (!tComps.has(k)) out.push({ kind: 'removed-component', id: k });
    const fWires = new Map((from.wires ?? []).map((w) => [wireKey(w), w]));
    const tWires = new Map((to.wires ?? []).map((w) => [wireKey(w), w]));
    for (const [k, w] of tWires) {
      if (!fWires.has(k)) out.push({ kind: 'added-wire', id: k });
      else if (stableStringify(fWires.get(k)) !== stableStringify(w)) out.push({ kind: 'modified-wire', id: k });
    }
    for (const k of fWires.keys()) if (!tWires.has(k)) out.push({ kind: 'removed-wire', id: k });
    if ((from.code ?? null) !== (to.code ?? null)) out.push({ kind: 'code-changed' });
    if ((from.netlist ?? null) !== (to.netlist ?? null)) out.push({ kind: 'netlist-changed' });
    if (stableStringify(from.simConfig ?? null) !== stableStringify(to.simConfig ?? null)) out.push({ kind: 'simconfig-changed' });
    return out;
  }

  checkout(projectId: string, commitId: string): VcsSnapshot {
    const repo = this.getRepo(projectId);
    if (!repo) throw new Error('Repository not found');
    const c = repo.commits[commitId];
    if (!c) throw new Error('Unknown commit id');
    repo.branches[repo.currentBranch].head = commitId;
    this.persist();
    return JSON.parse(stableStringify(c.snapshot)) as VcsSnapshot;
  }

  revert(projectId: string, commitId: string, author = 'local-user'): VcsCommit {
    const repo = this.getRepo(projectId);
    if (!repo) throw new Error('Repository not found');
    const target = repo.commits[commitId];
    if (!target) throw new Error('Unknown commit id');
    // Always create a new commit (bypass the empty-tree guard: restoring the
    // same tree as head is still a meaningful history event).
    const branch = repo.branches[repo.currentBranch];
    const parents = branch.head ? [branch.head] : [];
    const message = `Revert ${commitId.slice(0, 8)}: ${target.message}`;
    const timestamp = Date.now();
    const id = commitIdFor(repo.id, parents, target.treeHash, message, author, timestamp);
    const commit: VcsCommit = {
      id, repoId: repo.id, parents, treeHash: target.treeHash, message, author, timestamp,
      snapshot: JSON.parse(stableStringify(target.snapshot)) as VcsSnapshot,
    };
    repo.commits[id] = commit;
    branch.head = id;
    this.persist();
    return commit;
  }

  createBranch(projectId: string, name: string, fromId?: string): VcsBranch {
    const repo = this.initRepo(projectId);
    const n = name.trim();
    if (!n) throw new Error('Branch name is required');
    if (repo.branches[n]) throw new Error(`Branch '${n}' already exists`);
    const base = fromId ?? repo.branches[repo.currentBranch].head ?? null;
    if (fromId && !repo.commits[fromId]) throw new Error('Unknown base commit');
    repo.branches[n] = { name: n, head: base };
    this.persist();
    return repo.branches[n];
  }

  switchBranch(projectId: string, name: string): VcsBranch {
    const repo = this.getRepo(projectId);
    if (!repo) throw new Error('Repository not found');
    const b = repo.branches[name];
    if (!b) throw new Error(`Branch '${name}' not found`);
    repo.currentBranch = name;
    this.persist();
    return b;
  }

  listBranches(projectId: string): VcsBranch[] {
    const repo = this.getRepo(projectId);
    if (!repo) return [];
    return Object.values(repo.branches);
  }

  tag(projectId: string, name: string, commitId?: string): void {
    const repo = this.getRepo(projectId);
    if (!repo) throw new Error('Repository not found');
    const n = name.trim();
    if (!n) throw new Error('Tag name is required');
    const target = commitId ?? repo.branches[repo.currentBranch].head;
    if (!target || !repo.commits[target]) throw new Error('No commit to tag');
    repo.tags[n] = target;
    this.persist();
  }

  merge(projectId: string, sourceBranch: string, author = 'local-user'): VcsCommit {
    const repo = this.getRepo(projectId);
    if (!repo) throw new Error('Repository not found');
    const target = repo.branches[repo.currentBranch];
    const source = repo.branches[sourceBranch];
    if (!source) throw new Error(`Branch '${sourceBranch}' not found`);
    if (!source.head) throw new Error(`Branch '${sourceBranch}' is empty`);
    if (!target.head) {
      target.head = source.head;
      this.persist();
      return repo.commits[source.head];
    }
    if (target.head === source.head) return repo.commits[target.head];
    const base = this.findBase(repo, target.head, source.head);
    const tSnap = repo.commits[target.head].snapshot;
    const sSnap = repo.commits[source.head].snapshot;
    const bSnap = base ? repo.commits[base].snapshot : null;
    const merged = this.merge3(bSnap, tSnap, sSnap);
    const treeHash = snapshotTreeHash(merged);
    const timestamp = Date.now();
    const parents = [target.head, source.head];
    const id = commitIdFor(repo.id, parents, treeHash, `Merge branch '${sourceBranch}'`, author, timestamp);
    const commit: VcsCommit = {
      id, repoId: repo.id, parents, treeHash,
      message: `Merge branch '${sourceBranch}'`, author, timestamp,
      snapshot: JSON.parse(stableStringify(merged)) as VcsSnapshot,
    };
    repo.commits[id] = commit;
    target.head = id;
    this.persist();
    return commit;
  }

  private ancestors(repo: VcsRepo, from: string): Set<string> {
    const out = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop() as string;
      if (out.has(cur)) continue;
      out.add(cur);
      const c = repo.commits[cur];
      if (c) stack.push(...c.parents);
    }
    return out;
  }

  private findBase(repo: VcsRepo, a: string, b: string): string | null {
    const ancA = this.ancestors(repo, a);
    let cur: string | null = b;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (ancA.has(cur)) return cur;
      cur = repo.commits[cur]?.parents[0] ?? null;
    }
    return null;
  }

  private merge3(base: VcsSnapshot | null, ours: VcsSnapshot, theirs: VcsSnapshot): VcsSnapshot {
    const keyed = (b: unknown[], o: unknown[], t: unknown[], key: (x: unknown) => string): unknown[] => {
      const bMap = new Map(b.map((x) => [key(x), stableStringify(x)]));
      const oMap = new Map(o.map((x) => [key(x), x]));
      const tMap = new Map(t.map((x) => [key(x), x]));
      const keys = new Set([...oMap.keys(), ...tMap.keys()]);
      const out: unknown[] = [];
      for (const k of keys) {
        const bv = bMap.get(k);
        const hasO = oMap.has(k);
        const hasT = tMap.has(k);
        const ov = hasO ? stableStringify(oMap.get(k)) : undefined;
        const tv = hasT ? stableStringify(tMap.get(k)) : undefined;
        if (hasO && hasT) {
          if (ov === tv) out.push(oMap.get(k));
          else if (bv === ov) out.push(tMap.get(k));
          else out.push(oMap.get(k));
        } else if (hasO) {
          if (bv !== ov) out.push(oMap.get(k));
        } else if (hasT) {
          if (bv !== tv) out.push(tMap.get(k));
        }
      }
      return out;
    };
    const scalar = <T>(bv: T, ov: T, tv: T): T => {
      const b = stableStringify(bv ?? null);
      if (stableStringify(tv ?? null) !== b && stableStringify(ov ?? null) === b) return tv;
      return ov;
    };
    return {
      components: keyed(base?.components ?? [], ours.components ?? [], theirs.components ?? [], compKey),
      wires: keyed(base?.wires ?? [], ours.wires ?? [], theirs.wires ?? [], wireKey),
      code: scalar(base?.code ?? null, ours.code ?? null, theirs.code ?? null),
      netlist: scalar(base?.netlist ?? null, ours.netlist ?? null, theirs.netlist ?? null),
      simConfig: scalar(base?.simConfig ?? null, ours.simConfig ?? null, theirs.simConfig ?? null),
      meta: ours.meta ?? theirs.meta ?? null,
    };
  }
}

export const vcsService = new VcsService();

