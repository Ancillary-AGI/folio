import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collaborativeEditor, type CollabUser } from './collaborativeEditor';

const user = (id = 'user-1', name = 'Ada'): CollabUser => ({
  id,
  name,
  email: `${id}@folio.test`,
  color: '#4f46e5',
  isActive: true,
  lastSeen: 0,
});

describe('CollaborativeEditor local session', () => {
  beforeEach(() => {
    collaborativeEditor.removeAllListeners();
    collaborativeEditor.disconnect();
  });

  it('joins a local session when Supabase is not configured', async () => {
    const joined = vi.fn();
    collaborativeEditor.on('session:joined', joined);
    const connected = await collaborativeEditor.connect(user(), 'project-a');

    expect(connected).toBe(true);
    expect(collaborativeEditor.isUsingRealtime()).toBe(false);
    expect(collaborativeEditor.getCurrentUser()?.id).toBe('user-1');
    expect(collaborativeEditor.getCurrentSession()?.projectId).toBe('project-a');
    expect(collaborativeEditor.getConnectedUsers().map((member) => member.id)).toEqual(['user-1']);
    expect(joined).toHaveBeenCalledTimes(1);
  });

  it('emits user and session lifecycle events and clears state on disconnect', async () => {
    const left = vi.fn();
    collaborativeEditor.on('session:left', left);
    await collaborativeEditor.connect(user(), 'project-b');
    collaborativeEditor.disconnect();

    expect(left).toHaveBeenCalledTimes(1);
    expect(collaborativeEditor.getCurrentSession()).toBeNull();
    expect(collaborativeEditor.getCurrentUser()).toBeNull();
    expect(collaborativeEditor.getConnectedUsers()).toEqual([]);
  });

  it('orders local operations with increasing lamport clocks and unique ids', async () => {
    await collaborativeEditor.connect(user(), 'project-c');
    await collaborativeEditor.sendOperation('component_add', { componentId: 'r1' });
    await collaborativeEditor.sendOperation('wire_add', { wireId: 'w1' });
    await collaborativeEditor.sendOperation('component_update', { componentId: 'r1', value: '2k' });

    const operations = collaborativeEditor.getCurrentSession()?.operations ?? [];
    expect(operations.map((op) => op.type)).toEqual(['component_add', 'wire_add', 'component_update']);
    expect(operations[1].lamport).toBeGreaterThan(operations[0].lamport);
    expect(operations[2].lamport).toBeGreaterThan(operations[1].lamport);
    expect(new Set(operations.map((op) => op.id)).size).toBe(3);
    expect(operations.every((op) => op.userId === 'user-1')).toBe(true);
    expect(operations.every((op) => op.projectId === 'project-c')).toBe(true);
    expect(operations[0].payload).toEqual({ componentId: 'r1' });
  });

  it('ignores operations and cursor moves without an active session', async () => {
    await expect(collaborativeEditor.sendOperation('component_add', { componentId: 'x' })).resolves.toBeUndefined();
    await expect(collaborativeEditor.sendCursorPosition(10, 20)).resolves.toBeUndefined();
    expect(collaborativeEditor.getCurrentSession()).toBeNull();
  });

  it('unsubscribes listeners with off()', async () => {
    const handler = vi.fn();
    collaborativeEditor.on('session:joined', handler);
    collaborativeEditor.off('session:joined', handler);
    await collaborativeEditor.connect(user(), 'project-d');
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps one operation log per project session', async () => {
    await collaborativeEditor.connect(user('user-1'), 'project-e');
    await collaborativeEditor.sendOperation('component_add', { componentId: 'a' });
    const first = collaborativeEditor.getCurrentSession()!;
    collaborativeEditor.disconnect();

    await collaborativeEditor.connect(user('user-2'), 'project-f');
    await collaborativeEditor.sendOperation('component_add', { componentId: 'b' });
    const second = collaborativeEditor.getCurrentSession()!;

    expect(first.projectId).toBe('project-e');
    expect(second.projectId).toBe('project-f');
    expect(second.operations).toHaveLength(1);
    expect(second.users.has('user-2')).toBe(true);
  });

  it('treats the legacy receiveOperation helper as a no-op', async () => {
    await collaborativeEditor.connect(user(), 'project-g');
    expect(() => collaborativeEditor.receiveOperation()).not.toThrow();
    expect(collaborativeEditor.getCurrentSession()?.operations).toEqual([]);
  });
});
