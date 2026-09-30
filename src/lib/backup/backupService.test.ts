import { beforeEach, describe, expect, it } from 'vitest';
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

  it('returns null for missing or malformed checkpoint payloads', () => {
    const service = new BackupService();
    expect(service.restore('missing')).toBeNull();

    const checkpoint = service.createBackup('project-a', { valid: true });
    localStorage.setItem('folio.backups', JSON.stringify([
      { ...checkpoint, payload: '{invalid json' },
    ]));

    expect(new BackupService().restore(checkpoint.id, 'project-a')).toBeNull();
  });
});