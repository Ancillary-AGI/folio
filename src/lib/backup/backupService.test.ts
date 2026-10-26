import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupService } from './backupService';

describe('BackupService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('lists and restores checkpoints only for their project', () => {
    const service = new BackupService();
    const data = { components: [{ id: 'component-1' }], wires: [], viewport: { zoom: 1 } };
    const checkpoint = service.createBackup('project-a', data, 'Stable layout');
    service.createBackup('project-b', { components: [], wires: [] });

    expect(service.listBackups('project-a')).toHaveLength(1);
    expect(service.restore(checkpoint.id, 'project-b')).toBeNull();
    expect(service.restore(checkpoint.id, 'project-a')).toEqual(data);
  });

  it('retains at most 50 checkpoints per project without evicting other projects', () => {
    const service = new BackupService();
    service.createBackup('project-b', { revision: 'kept' });

    for (let revision = 0; revision < 51; revision += 1) {
      service.createBackup('project-a', { revision });
    }

    expect(service.listBackups('project-a')).toHaveLength(50);
    expect(service.listBackups('project-b')).toHaveLength(1);
    expect(service.listBackups('project-b')[0].projectId).toBe('project-b');
  });

  it('purges a deleted project without touching other projects', () => {
    const service = new BackupService();
    service.createBackup('project-a', { keep: false });
    service.createBackup('project-a', { keep: false, second: true });
    service.createBackup('project-b', { keep: true });

    expect(service.deleteProjectBackups('project-a')).toBe(2);
    expect(service.listBackups('project-a')).toHaveLength(0);
    expect(service.listBackups('project-b')).toHaveLength(1);
    expect(service.deleteProjectBackups('never-saved')).toBe(0);
    expect(new BackupService().listBackups('project-a')).toHaveLength(0);
    expect(new BackupService().listBackups('project-b')).toHaveLength(1);
  });

  it('returns null for missing or malformed checkpoint payloads', () => {
    const service = new BackupService();
    expect(service.restore('missing')).toBeNull();

    const checkpoint = service.createBackup('project-a', { valid: true });
    localStorage.setItem('folio.backups', JSON.stringify([
      { ...checkpoint, payload: '{invalid json' },
    ]));

    expect(new BackupService().restore(checkpoint.id, 'project-a')).toBeNull();
  });

  it('keeps a backup usable in-session and reports quota failures', () => {
    const original = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'folio.backups') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return original.call(this, key, value);
    });
    try {
      const service = new BackupService();
      const checkpoint = service.createBackup('project-a', { revision: 7 }, 'Quota test');
      expect(service.getStorageError()).toMatch(/browser storage is full/i);
      expect(service.restore(checkpoint.id, 'project-a')).toEqual({ revision: 7 });
    } finally {
      spy.mockRestore();
    }
  });
});