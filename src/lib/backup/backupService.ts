export interface ProjectBackup {
  id: string;
  projectId: string;
  createdAt: number;
  label: string;
  sizeBytes: number;
  payload: string;
  offline: boolean;
}

export class BackupService {
  private backups: ProjectBackup[] = [];
  private storageKey = 'folio.backups';
  private readonly maxBackupsPerProject = 50;
  private storageError: string | null = null;
  /** Monotonic per-process suffix — deterministic and collision-free. */
  private static idSeq = 0;

  constructor() {
    this.hydrate();
  }

  /** Non-null when the last backup write (or read) failed. */
  getStorageError(): string | null {
    return this.storageError;
  }

  private hydrate(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        this.backups = Array.isArray(parsed)
          ? parsed.filter((backup): backup is ProjectBackup =>
              typeof backup?.id === 'string' &&
              typeof backup?.projectId === 'string' &&
              typeof backup?.createdAt === 'number' &&
              typeof backup?.label === 'string' &&
              typeof backup?.payload === 'string'
            )
          : [];
      }
    } catch {
      this.backups = [];
      this.storageError = 'saved backups could not be read';
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.backups));
      this.storageError = null;
    } catch (error) {
      const name = typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name)
        : '';
      this.storageError = name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
        ? 'browser storage is full'
        : error instanceof Error ? error.message : String(error);
    }
  }

  createBackup(projectId: string, data: Record<string, unknown>, label = 'auto'): ProjectBackup {
    const payload = JSON.stringify(data);
    const backup: ProjectBackup = {
      id: `bak_${Date.now()}_${++BackupService.idSeq}`,
      projectId,
      createdAt: Date.now(),
      label,
      sizeBytes: payload.length,
      payload,
      offline: typeof navigator !== 'undefined' ? !navigator.onLine : true,
    };
    this.backups.push(backup);
    const projectBackups = this.backups
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => right.createdAt - left.createdAt);
    const retainedIds = new Set(projectBackups.slice(0, this.maxBackupsPerProject).map((item) => item.id));
    this.backups = this.backups.filter((item) => item.projectId !== projectId || retainedIds.has(item.id));
    this.persist();
    return backup;
  }

  listBackups(projectId: string): ProjectBackup[] {
    return this.backups.filter((b) => b.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Drop every saved backup for a deleted project; returns how many were removed. */
  deleteProjectBackups(projectId: string): number {
    const before = this.backups.length;
    this.backups = this.backups.filter((backup) => backup.projectId !== projectId);
    const removed = before - this.backups.length;
    if (removed > 0) this.persist();
    return removed;
  }

  restore(backupId: string, projectId?: string): Record<string, unknown> | null {
    const backup = this.backups.find((item) =>
      item.id === backupId && (!projectId || item.projectId === projectId)
    );
    if (!backup) return null;
    try {
      const restored: unknown = JSON.parse(backup.payload);
      return restored && typeof restored === 'object' && !Array.isArray(restored)
        ? restored as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
}

export const backupService = new BackupService();
