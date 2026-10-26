/**
 * VCS Service - real content-addressed version control for designs.
 * Git-like, local-first: repo per projectId, persisted to localStorage.
 * commit = { id sha256, parents[], treeHash, message, author, timestamp, snapshot }
 *
 * Persistence stores the first commit of a chain in full and every later commit
 * as a JSON patch against its first parent (falling back to a full copy when the
 * patch is not smaller). Snapshots are reconstructed and hash-checked on load,
 * so a corrupted record is reported instead of silently served as history.
 */

export interface VcsSnapshot {
  components: unknown[];
  wires: unknown[];
  code?: string | null;
  /** Routed/placed physical board, when the design has one. */
  pcbLayout?: unknown;
  /** Mechanical assembly bodies. */
  mechanicalParts?: unknown[];
  /**
   * Design state of every other CAD domain (RF, control, machines, HDL, FPGA,
   * IC, robotics, visual programs, …), keyed by domain id. Values must be
   * plain JSON because commits are content-addressed and delta-compressed.
   */
  domains?: Record<string, unknown>;
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

export type VcsDiffKind =
  | 'initial'
  | 'added-component' | 'removed-component' | 'modified-component'
  | 'added-wire' | 'removed-wire' | 'modified-wire'
  | 'added-mechanical' | 'removed-mechanical' | 'modified-mechanical'
  | 'added-domain' | 'removed-domain' | 'modified-domain'
  | 'code-changed' | 'netlist-changed' | 'simconfig-changed';

export interface VcsDiffEntry {
  kind: VcsDiffKind;
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

type JsonPathSegment = string | number;

interface JsonOp {
  op: 'add' | 'remove' | 'replace';
  path: JsonPathSegment[];
  value?: unknown;
}

interface PersistedCommit {
  id?: unknown;
  repoId?: unknown;
  parents?: unknown;
  treeHash?: unknown;
  message?: unknown;
  author?: unknown;
  timestamp?: unknown;
  /** v2 full snapshot (root commit or when a patch would not be smaller). */
  full?: unknown;
  /** v2 patch against parents[0].snapshot. */
  delta?: unknown;
  /** v1 inline snapshot. */
  snapshot?: unknown;
}

interface PersistedRepo {
  format?: unknown;
  id?: unknown;
  projectId?: unknown;
  branches?: unknown;
  currentBranch?: unknown;
  commits?: unknown;
  tags?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSnapshot(value: unknown): value is VcsSnapshot {
  return isRecord(value) && Array.isArray(value.components) && Array.isArray(value.wires);
}

/** Deep copy a JSON snapshot; structuredClone keeps history replay fast. */
function cloneSnapshot(snapshot: VcsSnapshot): VcsSnapshot {
  if (typeof structuredClone === 'function') return structuredClone(snapshot);
  return JSON.parse(stableStringify(snapshot)) as VcsSnapshot;
}

function describeStorageError(error: unknown): string {
  const name = isRecord(error) && typeof error.name === 'string' ? error.name : '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'browser storage is full';
  return error instanceof Error ? error.message : String(error);
}

/* ── JSON patching ──────────────────────────────────────────────────────────
 * Snapshots are plain JSON. A commit stores only the operations that turn its
 * first parent's snapshot into its own, which keeps long local histories well
 * inside the browser's storage quota. Patches are index-based so array order is
 * reproduced exactly; reconstruction is verified against the commit tree hash.
 */

function diffJson(a: unknown, b: unknown, path: JsonPathSegment[], ops: JsonOp[]): void {
  if (a === b) return;
  if (isRecord(a) && isRecord(b)) {
    for (const key of Object.keys(a)) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) ops.push({ op: 'remove', path: [...path, key] });
    }
    for (const key of Object.keys(b)) {
      if (!Object.prototype.hasOwnProperty.call(a, key)) {
        ops.push({ op: 'add', path: [...path, key], value: b[key] });
      } else {
        diffJson(a[key], b[key], [...path, key], ops);
      }
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const common = Math.min(a.length, b.length);
    for (let index = 0; index < common; index++) diffJson(a[index], b[index], [...path, index], ops);
    if (b.length > a.length) {
      for (let index = a.length; index < b.length; index++) ops.push({ op: 'add', path: [...path, index], value: b[index] });
    } else {
      for (let index = a.length - 1; index >= b.length; index--) ops.push({ op: 'remove', path: [...path, index] });
    }
    return;
  }
  ops.push({ op: 'replace', path, value: b });
}

function applyJsonOps(base: VcsSnapshot, ops: unknown[]): VcsSnapshot {
  const target = cloneSnapshot(base) as unknown;
  for (const raw of ops) {
    if (!isRecord(raw) || !Array.isArray(raw.path) || typeof raw.op !== 'string') {
      throw new Error('Malformed snapshot patch');
    }
    const path = raw.path.filter((segment): segment is JsonPathSegment => typeof segment === 'string' || typeof segment === 'number');
    if (path.length !== raw.path.length || path.length === 0) throw new Error('Malformed snapshot patch path');
    let parent: unknown = target;
    for (let index = 0; index < path.length - 1; index++) {
      const segment = path[index];
      parent = Array.isArray(parent) && typeof segment === 'number'
        ? parent[segment]
        : isRecord(parent) && typeof segment === 'string'
          ? parent[segment]
          : undefined;
    }
    const key = path[path.length - 1];
    if (Array.isArray(parent) && typeof key === 'number') {
      if (raw.op === 'remove') parent.splice(key, 1);
      else if (raw.op === 'add') parent.splice(key, 0, raw.value);
      else if (raw.op === 'replace') parent[key] = raw.value;
      else throw new Error(`Unsupported snapshot patch op ${raw.op}`);
    } else if (isRecord(parent) && typeof key === 'string') {
      if (raw.op === 'remove') delete parent[key];
      else if (raw.op === 'add' || raw.op === 'replace') parent[key] = raw.value;
      else throw new Error(`Unsupported snapshot patch op ${raw.op}`);
    } else {
      throw new Error('Malformed snapshot patch target');
    }
  }
  if (!isSnapshot(target)) throw new Error('Snapshot patch did not produce a snapshot');
  return target;
}

/* ── Persistence ───────────────────────────────────────────────────────────
 * v2 record: every commit carries either `full` or `delta` (against parents[0]).
 * v1 records (inline `snapshot`) are still read so existing browsers migrate
 * without losing history; the next successful write upgrades the repo.
 */

const commitFragmentCache = new WeakMap<VcsCommit, string>();

function serializeCommit(repo: VcsRepo, commit: VcsCommit): string {
  const cached = commitFragmentCache.get(commit);
  if (cached) return cached;
  const parent = commit.parents[0] ? repo.commits[commit.parents[0]] : undefined;
  const full = stableStringify(commit.snapshot);
  let body = `"full":${full}`;
  if (parent) {
    const ops: JsonOp[] = [];
    diffJson(parent.snapshot, commit.snapshot, [], ops);
    const delta = JSON.stringify(ops);
    if (delta.length < full.length) body = `"delta":${delta}`;
  }
  const fragment = `{"id":${JSON.stringify(commit.id)},"repoId":${JSON.stringify(commit.repoId)},"parents":${JSON.stringify(commit.parents)},"treeHash":${JSON.stringify(commit.treeHash)},"message":${JSON.stringify(commit.message)},"author":${JSON.stringify(commit.author)},"timestamp":${JSON.stringify(commit.timestamp)},${body}}`;
  commitFragmentCache.set(commit, fragment);
  return fragment;
}

function serializeRepo(repo: VcsRepo): string {
  const commits = Object.keys(repo.commits)
    .map((id) => `${JSON.stringify(id)}:${serializeCommit(repo, repo.commits[id])}`)
    .join(',');
  return `{"format":2,"id":${JSON.stringify(repo.id)},"projectId":${JSON.stringify(repo.projectId)},"branches":${JSON.stringify(repo.branches)},"currentBranch":${JSON.stringify(repo.currentBranch)},"commits":{${commits}},"tags":${JSON.stringify(repo.tags)},"createdAt":${JSON.stringify(repo.createdAt)},"updatedAt":${JSON.stringify(repo.updatedAt)}}`;
}

function hydrateRepo(value: unknown): { repo: VcsRepo | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { repo: null, errors: ['Repository record is not an object'] };
  const raw = value as PersistedRepo;
  if (typeof raw.id !== 'string' || typeof raw.projectId !== 'string') {
    return { repo: null, errors: ['Repository record lacks an id or project id'] };
  }
  const repoId = raw.id;
  const projectId = raw.projectId;
  const rawCommits = isRecord(raw.commits) ? raw.commits : {};
  const commits: Record<string, VcsCommit> = {};
  const resolving = new Set<string>();

  const resolve = (commitId: string): VcsCommit | null => {
    if (commits[commitId]) return commits[commitId];
    const record = rawCommits[commitId];
    if (!isRecord(record)) return null;
    if (resolving.has(commitId)) {
      errors.push(`Commit ${commitId.slice(0, 8)} has a cyclic parent chain`);
      return null;
    }
    resolving.add(commitId);
    const persisted = record as PersistedCommit;
    const parents = Array.isArray(persisted.parents)
      ? persisted.parents.filter((parent): parent is string => typeof parent === 'string')
      : [];
    let snapshot: VcsSnapshot | null = null;
    if (isSnapshot(persisted.full)) snapshot = persisted.full;
    else if (isSnapshot(persisted.snapshot)) snapshot = persisted.snapshot;
    else if (Array.isArray(persisted.delta) && parents[0]) {
      const parent = resolve(parents[0]);
      if (parent) {
        try {
          snapshot = applyJsonOps(parent.snapshot, persisted.delta);
        } catch {
          snapshot = null;
        }
      }
    }
    resolving.delete(commitId);
    if (!snapshot) {
      errors.push(`Commit ${commitId.slice(0, 8)} could not be reconstructed`);
      return null;
    }
    const recordedTree = typeof persisted.treeHash === 'string' ? persisted.treeHash : '';
    const treeHash = recordedTree || snapshotTreeHash(snapshot);
    if (snapshotTreeHash(snapshot) !== treeHash) {
      errors.push(`Commit ${commitId.slice(0, 8)} failed its content hash check`);
    }
    const commit: VcsCommit = {
      id: typeof persisted.id === 'string' ? persisted.id : commitId,
      repoId: typeof persisted.repoId === 'string' ? persisted.repoId : repoId,
      parents,
      treeHash,
      message: typeof persisted.message === 'string' ? persisted.message : '(unreadable message)',
      author: typeof persisted.author === 'string' ? persisted.author : 'unknown',
      timestamp: typeof persisted.timestamp === 'number' ? persisted.timestamp : 0,
      snapshot,
    };
    commits[commitId] = commit;
    return commit;
  };

  for (const commitId of Object.keys(rawCommits)) resolve(commitId);

  const branches: Record<string, VcsBranch> = {};
  if (isRecord(raw.branches)) {
    for (const [name, branch] of Object.entries(raw.branches)) {
      if (!isRecord(branch)) continue;
      const head = typeof branch.head === 'string' ? branch.head : null;
      if (head && !commits[head]) errors.push(`Branch '${name}' points at a missing commit`);
      branches[name] = { name, head: head && commits[head] ? head : null };
    }
  }
  if (!branches.main) branches.main = { name: 'main', head: null };
  const currentBranch = typeof raw.currentBranch === 'string' && branches[raw.currentBranch] ? raw.currentBranch : 'main';
  const tags: Record<string, string> = {};
  if (isRecord(raw.tags)) {
    for (const [name, commitId] of Object.entries(raw.tags)) {
      if (typeof commitId === 'string' && commits[commitId]) tags[name] = commitId;
    }
  }
  return {
    repo: {
      id: repoId,
      projectId,
      branches,
      currentBranch,
      commits,
      tags,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    },
    errors,
  };
}

function hydrateRepos(raw: string): { repos: Record<string, VcsRepo>; error: string | null } {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error('stored value is not an object');
  const repos: Record<string, VcsRepo> = {};
  const problems: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    const { repo, errors } = hydrateRepo(value);
    if (repo) repos[key] = repo;
    else problems.push(`Repository ${key} is unreadable`);
    problems.push(...errors);
  }
  return { repos, error: problems.length ? [...new Set(problems)].join('; ') : null };
}

function loadRepos(): { repos: Record<string, VcsRepo>; error: string | null } {
  if (typeof localStorage === 'undefined') return { repos: {}, error: null };
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(VCS_STORAGE_KEY);
  } catch (error) {
    return { repos: {}, error: `Version history could not be read (${describeStorageError(error)})` };
  }
  if (!raw) return { repos: {}, error: null };
  try {
    return hydrateRepos(raw);
  } catch (error) {
    // Keep the unreadable payload aside for recovery, then start a clean store so
    // the app remains usable instead of failing every read.
    try {
      localStorage.setItem(`${VCS_STORAGE_KEY}.corrupt.${Date.now()}`, raw);
    } catch {
      /* quarantine copy is best-effort */
    }
    try {
      localStorage.removeItem(VCS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return { repos: {}, error: `Saved version history could not be read (${describeStorageError(error)}) and was set aside` };
  }
}

function saveRepos(repos: Record<string, VcsRepo>): { ok: boolean; error: string | null } {
  if (typeof localStorage === 'undefined') return { ok: false, error: 'browser storage is unavailable' };
  try {
    const parts = Object.entries(repos).map(([key, repo]) => `${JSON.stringify(key)}:${serializeRepo(repo)}`);
    localStorage.setItem(VCS_STORAGE_KEY, `{${parts.join(',')}}`);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: describeStorageError(error) };
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

function partKey(p: unknown): string {
  const o = p as { id?: string };
  return String(o?.id ?? stableStringify(p));
}


class VcsService {
  private repos: Record<string, VcsRepo>;
  private persistenceError: string | null = null;
  private lastSavedAt: number | null = null;
  private readonly handleStorageEvent = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== VCS_STORAGE_KEY) return;
    const loaded = loadRepos();
    this.repos = loaded.repos;
    this.persistenceError = loaded.error;
    this.lastSavedAt = null;
  };

  constructor() {
    const loaded = loadRepos();
    this.repos = loaded.repos;
    this.persistenceError = loaded.error;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', this.handleStorageEvent);
    }
  }

  /** Non-null when the last write (or the last read) of history failed. */
  getPersistenceError(): string | null {
    return this.persistenceError;
  }

  getLastSavedAt(): number | null {
    return this.lastSavedAt;
  }

  private persist(): void {
    const now = Date.now();
    for (const repo of Object.values(this.repos)) repo.updatedAt = now;
    const result = saveRepos(this.repos);
    if (result.ok) {
      this.persistenceError = null;
      this.lastSavedAt = now;
    } else {
      this.persistenceError = result.error;
    }
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

  /** Drop a project's whole local history when the project itself is deleted. */
  removeRepo(projectId: string): boolean {
    const id = `repo_${projectId.trim()}`;
    if (!this.repos[id]) return false;
    delete this.repos[id];
    this.persist();
    return true;
  }

  reset(): void {
    this.repos = {};
    this.persistenceError = null;
    this.lastSavedAt = null;
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(VCS_STORAGE_KEY);
    } catch (error) {
      this.persistenceError = describeStorageError(error);
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
    if (!h) return [{ kind: 'initial', detail: 'initial commit pending' }];
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
    const fMech = new Map((from.mechanicalParts ?? []).map((p) => [partKey(p), p]));
    const tMech = new Map((to.mechanicalParts ?? []).map((p) => [partKey(p), p]));
    for (const [k, p] of tMech) {
      if (!fMech.has(k)) out.push({ kind: 'added-mechanical', id: k });
      else if (stableStringify(fMech.get(k)) !== stableStringify(p)) out.push({ kind: 'modified-mechanical', id: k });
    }
    for (const k of fMech.keys()) if (!tMech.has(k)) out.push({ kind: 'removed-mechanical', id: k });
    const fDomains = isRecord(from.domains) ? from.domains : {};
    const tDomains = isRecord(to.domains) ? to.domains : {};
    for (const key of new Set([...Object.keys(fDomains), ...Object.keys(tDomains)])) {
      const had = Object.prototype.hasOwnProperty.call(fDomains, key);
      const has = Object.prototype.hasOwnProperty.call(tDomains, key);
      if (has && !had) out.push({ kind: 'added-domain', id: key });
      else if (!has && had) out.push({ kind: 'removed-domain', id: key });
      else if (stableStringify(fDomains[key]) !== stableStringify(tDomains[key])) out.push({ kind: 'modified-domain', id: key });
    }
    if ((from.code ?? null) !== (to.code ?? null)) out.push({ kind: 'code-changed' });
    if ((from.netlist ?? null) !== (to.netlist ?? null)) out.push({ kind: 'netlist-changed' });
    if (stableStringify(from.simConfig ?? null) !== stableStringify(to.simConfig ?? null)) out.push({ kind: 'simconfig-changed' });
    return out;
  }

  /**
   * Return the snapshot of a past commit without moving the branch. Restoring a
   * design is a read: the user's next commit records the restoration on top of
   * the current head, so the newer commits they restore over stay reachable.
   */
  checkout(projectId: string, commitId: string): VcsSnapshot {
    const repo = this.getRepo(projectId);
    if (!repo) throw new Error('Repository not found');
    const c = repo.commits[commitId];
    if (!c) throw new Error('Unknown commit id');
    return cloneSnapshot(c.snapshot);
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
    const merged: VcsSnapshot = {
      components: keyed(base?.components ?? [], ours.components ?? [], theirs.components ?? [], compKey),
      wires: keyed(base?.wires ?? [], ours.wires ?? [], theirs.wires ?? [], wireKey),
      code: scalar(base?.code ?? null, ours.code ?? null, theirs.code ?? null),
      netlist: scalar(base?.netlist ?? null, ours.netlist ?? null, theirs.netlist ?? null),
      simConfig: scalar(base?.simConfig ?? null, ours.simConfig ?? null, theirs.simConfig ?? null),
      meta: ours.meta ?? theirs.meta ?? null,
    };
    const baseParts = base?.mechanicalParts;
    if (baseParts || ours.mechanicalParts || theirs.mechanicalParts) {
      merged.mechanicalParts = keyed(baseParts ?? [], ours.mechanicalParts ?? [], theirs.mechanicalParts ?? [], partKey);
    }
    if (base?.pcbLayout !== undefined || ours.pcbLayout !== undefined || theirs.pcbLayout !== undefined) {
      merged.pcbLayout = this.mergeValue(base?.pcbLayout, ours.pcbLayout, theirs.pcbLayout);
    }
    if (base?.domains || ours.domains || theirs.domains) {
      merged.domains = (this.mergeValue(base?.domains ?? {}, ours.domains ?? {}, theirs.domains ?? {}) ?? {}) as Record<string, unknown>;
    }
    return merged;
  }

  /**
   * Three-way merge for arbitrary JSON. Identical changes take either side; a
   * change on one side wins over the unchanged base; when both sides changed
   * differently, records merge key-by-key, id-bearing arrays merge by id, and
   * any remaining scalar conflict resolves to ours (the checked-out branch).
   */
  private mergeValue(base: unknown, ours: unknown, theirs: unknown): unknown {
    const b = base === undefined ? undefined : stableStringify(base);
    const o = stableStringify(ours);
    const t = stableStringify(theirs);
    if (o === t) return ours;
    if (b === o) return theirs;
    if (b === t) return ours;
    if (isRecord(base) && isRecord(ours) && isRecord(theirs)) {
      const out: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
        const hasOur = Object.prototype.hasOwnProperty.call(ours, key);
        const hasTheir = Object.prototype.hasOwnProperty.call(theirs, key);
        if (!hasOur && !hasTheir) continue;
        const bv = base[key];
        let value: unknown;
        if (!hasOur) value = stableStringify(bv) === stableStringify(theirs[key]) ? undefined : theirs[key];
        else if (!hasTheir) value = stableStringify(bv) === stableStringify(ours[key]) ? undefined : ours[key];
        else value = this.mergeValue(bv, ours[key], theirs[key]);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    if (Array.isArray(base) && Array.isArray(ours) && Array.isArray(theirs)) {
      const idArrays = [base, ours, theirs].every((list) =>
        list.every((item) => isRecord(item) && typeof item.id === 'string'),
      );
      if (idArrays) return this.mergeIdArrays(base, ours, theirs);
    }
    return ours;
  }

  private mergeIdArrays(base: unknown[], ours: unknown[], theirs: unknown[]): unknown[] {
    const key = (value: unknown): string => String((value as { id?: string }).id);
    const bMap = new Map(base.map((item) => [key(item), stableStringify(item)]));
    const oMap = new Map(ours.map((item) => [key(item), item]));
    const tMap = new Map(theirs.map((item) => [key(item), item]));
    const out: unknown[] = [];
    for (const id of new Set([...oMap.keys(), ...tMap.keys()])) {
      const bv = bMap.get(id);
      const hasOur = oMap.has(id);
      const hasTheir = tMap.has(id);
      const o = hasOur ? stableStringify(oMap.get(id)) : undefined;
      const t = hasTheir ? stableStringify(tMap.get(id)) : undefined;
      if (hasOur && hasTheir) {
        if (o === t || bv === o) out.push(oMap.get(id));
        else if (bv === t) out.push(tMap.get(id));
        else out.push(this.mergeValue(
          bv === undefined ? undefined : JSON.parse(bv) as unknown,
          oMap.get(id),
          tMap.get(id),
        ));
      } else if (hasOur) {
        if (bv !== o) out.push(oMap.get(id));
      } else if (hasTheir) {
        if (bv !== t) out.push(tMap.get(id));
      }
    }
    return out;
  }
}

export const vcsService = new VcsService();
