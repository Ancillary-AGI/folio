import { Component, Wire, Net } from '../../types';

export interface Project {
  id: string;
  name: string;
  description: string;
  owner: User;
  collaborators: Collaborator[];
  components: Component[];
  wires: Wire[];
  nets: Net[];
  version: string;
  lastModified: number;
  status: 'draft' | 'review' | 'approved' | 'archived';
  tags: string[];
  permissions: ProjectPermissions;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'admin' | 'designer' | 'reviewer' | 'viewer';
  lastActive: number;
}

export interface Collaborator {
  user: User;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: number;
  permissions: string[];
}

export interface ProjectPermissions {
  allowPublicView: boolean;
  allowPublicEdit: boolean;
  requireApproval: boolean;
  allowedDomains: string[];
}

export interface Version {
  id: string;
  projectId: string;
  version: string;
  message: string;
  author: User;
  timestamp: number;
  changes: Change[];
  parentVersion?: string;
}

export interface Change {
  type: 'add' | 'modify' | 'delete';
  entityType: 'component' | 'wire' | 'net' | 'property';
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  description: string;
}

export interface Comment {
  id: string;
  projectId: string;
  author: User;
  content: string;
  timestamp: number;
  position?: { x: number; y: number };
  resolved: boolean;
  replies: Comment[];
  entityId?: string;
  entityType?: 'component' | 'wire' | 'net';
}

export interface RealTimeSession {
  id: string;
  projectId: string;
  participants: User[];
  activeUsers: Map<string, { cursor: { x: number; y: number }; lastActive: number }>;
  startTime: number;
  status: 'active' | 'paused' | 'ended';
}

export interface CloudSync {
  projectId: string;
  lastSync: number;
  syncStatus: 'synced' | 'syncing' | 'conflict' | 'offline';
  conflicts: SyncConflict[];
  remoteVersion: string;
  localVersion: string;
}

export interface SyncConflict {
  entityId: string;
  entityType: string;
  localValue: unknown;
  remoteValue: unknown;
  resolution?: 'local' | 'remote' | 'merge';
}

export class CollaborationService {
  private projects: Map<string, Project> = new Map();
  private sessions: Map<string, RealTimeSession> = new Map();
  private cloudSync: Map<string, CloudSync> = new Map();
  private currentUser: User | null = null;

  constructor() {
    this.initializeCloudSync();
  }

  // Project Management
  createProject(name: string, description: string, owner: User): Project {
    const project: Project = {
      id: `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      description,
      owner,
      collaborators: [{ user: owner, role: 'owner', joinedAt: Date.now(), permissions: ['read', 'write', 'delete', 'share'] }],
      components: [],
      wires: [],
      nets: [],
      version: '1.0.0',
      lastModified: Date.now(),
      status: 'draft',
      tags: [],
      permissions: {
        allowPublicView: false,
        allowPublicEdit: false,
        requireApproval: false,
        allowedDomains: []
      }
    };

    this.projects.set(project.id, project);
    this.initializeCloudSyncForProject(project.id);

    return project;
  }

  getProject(projectId: string): Project | undefined {
    return this.projects.get(projectId);
  }

  updateProject(projectId: string, updates: Partial<Project>): void {
    const project = this.projects.get(projectId);
    if (project) {
      Object.assign(project, updates);
      project.lastModified = Date.now();
      this.createVersion(projectId, 'Project updated', project);
    }
  }

  deleteProject(projectId: string): void {
    this.projects.delete(projectId);
    this.sessions.delete(projectId);
    this.cloudSync.delete(projectId);
  }

  // Collaboration Management
  addCollaborator(projectId: string, user: User, role: Collaborator['role'] = 'viewer'): void {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Project not found');

    // Check if user is already a collaborator
    const existingCollaborator = project.collaborators.find(c => c.user.id === user.id);
    if (existingCollaborator) {
      existingCollaborator.role = role;
      return;
    }

    const permissions = this.getPermissionsForRole(role);
    project.collaborators.push({
      user,
      role,
      joinedAt: Date.now(),
      permissions
    });
  }

  removeCollaborator(projectId: string, userId: string): void {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Project not found');

    project.collaborators = project.collaborators.filter(c => c.user.id !== userId);
  }

  // Version Control
  createVersion(projectId: string, message: string, newState: Project): Version {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Project not found');

    const version: Version = {
      id: `ver_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      projectId,
      version: this.incrementVersion(project.version),
      message,
      author: this.currentUser!,
      timestamp: Date.now(),
      changes: this.calculateChanges(project, newState),
      parentVersion: project.version
    };

    // Update project version
    project.version = version.version;
    project.lastModified = Date.now();

    return version;
  }

  getVersions(projectId: string): Version[] {
    // In a real implementation, this would query a database
    // For now, return mock versions
    return [
      {
        id: 'ver_001',
        projectId,
        version: '1.0.0',
        message: 'Initial version',
        author: this.currentUser!,
        timestamp: Date.now() - 86400000,
        changes: []
      }
    ];
  }

  revertToVersion(projectId: string, versionId: string): void {
    // Implement version reversion logic
    console.log(`Reverting project ${projectId} to version ${versionId}`);
  }

  // Real-time Collaboration
  startRealTimeSession(projectId: string, user: User): RealTimeSession {
    let session = this.sessions.get(projectId);

    if (!session) {
      session = {
        id: `session_${Date.now()}`,
        projectId,
        participants: [],
        activeUsers: new Map(),
        startTime: Date.now(),
        status: 'active'
      };
      this.sessions.set(projectId, session);
    }

    // Add user to session
    if (!session.participants.find(p => p.id === user.id)) {
      session.participants.push(user);
    }

    session.activeUsers.set(user.id, {
      cursor: { x: 0, y: 0 },
      lastActive: Date.now()
    });

    return session;
  }

  updateUserCursor(sessionId: string, userId: string, cursor: { x: number; y: number }): void {
    const session = Array.from(this.sessions.values()).find(s => s.id === sessionId);
    if (session) {
      const userActivity = session.activeUsers.get(userId);
      if (userActivity) {
        userActivity.cursor = cursor;
        userActivity.lastActive = Date.now();
      }
    }
  }

  endRealTimeSession(sessionId: string): void {
    const session = Array.from(this.sessions.values()).find(s => s.id === sessionId);
    if (session) {
      session.status = 'ended';
    }
  }

  // Comments and Review
  addComment(_projectId: string, comment: Omit<Comment, 'id' | 'timestamp' | 'resolved' | 'replies'>): Comment {
    const newComment: Comment = {
      ...comment,
      id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      resolved: false,
      replies: []
    };

    // In a real implementation, comments would be stored with the project
    console.log('Comment added:', newComment);

    return newComment;
  }

  resolveComment(commentId: string): void {
    // Mark comment as resolved
    console.log(`Comment ${commentId} resolved`);
  }

  // Cloud Synchronization
  syncProject(projectId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sync = this.cloudSync.get(projectId);
      if (!sync) {
        reject(new Error('Project not configured for cloud sync'));
        return;
      }

      sync.syncStatus = 'syncing';

      // Simulate cloud sync
      setTimeout(() => {
        sync.lastSync = Date.now();
        sync.syncStatus = 'synced';
        resolve();
      }, 2000 + Math.random() * 3000);
    });
  }

  resolveSyncConflict(projectId: string, conflictId: string, resolution: SyncConflict['resolution']): void {
    const sync = this.cloudSync.get(projectId);
    if (!sync) return;

    const conflict = sync.conflicts.find(c => c.entityId === conflictId);
    if (conflict) {
      conflict.resolution = resolution;
    }
  }

  // Access Control
  checkPermission(projectId: string, userId: string, permission: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;

    // Owner has all permissions
    if (project.owner.id === userId) return true;

    const collaborator = project.collaborators.find(c => c.user.id === userId);
    if (!collaborator) return false;

    return collaborator.permissions.includes(permission);
  }

  // Search and Discovery
  searchProjects(query: string, filters?: {
    owner?: string;
    tags?: string[];
    status?: Project['status'];
  }): Project[] {
    let results = Array.from(this.projects.values());

    // Text search
    if (query) {
      const lowerQuery = query.toLowerCase();
      results = results.filter(project =>
        project.name.toLowerCase().includes(lowerQuery) ||
        project.description.toLowerCase().includes(lowerQuery) ||
        project.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      );
    }

    // Apply filters
    if (filters) {
      if (filters.owner) {
        results = results.filter(project => project.owner.id === filters.owner);
      }
      if (filters.tags && filters.tags.length > 0) {
        results = results.filter(project =>
          filters.tags!.some(tag => project.tags.includes(tag))
        );
      }
      if (filters.status) {
        results = results.filter(project => project.status === filters.status);
      }
    }

    return results;
  }

  // Project Templates and Sharing
  createProjectFromTemplate(templateId: string, name: string, owner: User): Project {
    // Load template and create new project
    const template = this.getProjectTemplate(templateId);
    const project = this.createProject(name, `Based on ${template.name}`, owner);

    // Copy template content
    project.components = [...template.components];
    project.wires = [...template.wires];
    project.nets = [...template.nets];

    return project;
  }

  shareProject(projectId: string, shareOptions: {
    publicView?: boolean;
    publicEdit?: boolean;
    allowedDomains?: string[];
    expiryDate?: number;
  }): string {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Project not found');

    // Generate shareable link
    const shareId = `share_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const shareLink = `https://platform.example.com/shared/${shareId}`;

    // Update project permissions
    if (shareOptions.publicView !== undefined) {
      project.permissions.allowPublicView = shareOptions.publicView;
    }
    if (shareOptions.publicEdit !== undefined) {
      project.permissions.allowPublicEdit = shareOptions.publicEdit;
    }
    if (shareOptions.allowedDomains) {
      project.permissions.allowedDomains = shareOptions.allowedDomains;
    }

    return shareLink;
  }

  // Analytics and Insights
  getProjectAnalytics(projectId: string): {
    totalEdits: number;
    uniqueContributors: number;
    timeSpent: number;
    complexityScore: number;
    collaborationEfficiency: number;
  } {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Project not found');

    return {
      totalEdits: 0, // Would be calculated from version history
      uniqueContributors: project.collaborators.length,
      timeSpent: 0, // Would be tracked from sessions
      complexityScore: this.calculateComplexityScore(project),
      collaborationEfficiency: this.calculateCollaborationEfficiency(project)
    };
  }

  // Private helper methods
  private initializeCloudSync(): void {
    // Initialize cloud sync for all projects
    setInterval(() => {
      this.projects.forEach((_project, projectId) => {
        const sync = this.cloudSync.get(projectId);
        if (sync && sync.syncStatus === 'synced') {
          // Periodic sync check
          const timeSinceLastSync = Date.now() - sync.lastSync;
          if (timeSinceLastSync > 300000) { // 5 minutes
            this.syncProject(projectId).catch(error =>
              console.warn(`Auto-sync failed for project ${projectId}:`, error)
            );
          }
        }
      });
    }, 300000); // Check every 5 minutes
  }

  private initializeCloudSyncForProject(projectId: string): void {
    this.cloudSync.set(projectId, {
      projectId,
      lastSync: Date.now(),
      syncStatus: 'synced',
      conflicts: [],
      remoteVersion: '1.0.0',
      localVersion: '1.0.0'
    });
  }

  private getPermissionsForRole(role: Collaborator['role']): string[] {
    switch (role) {
      case 'owner':
        return ['read', 'write', 'delete', 'share', 'manage_users'];
      case 'editor':
        return ['read', 'write', 'comment'];
      case 'viewer':
        return ['read'];
      default:
        return [];
    }
  }

  private incrementVersion(version: string): string {
    const parts = version.split('.');
    const patch = parseInt(parts[2] || '0') + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }

  private calculateChanges(oldState: Project, newState: Project): Change[] {
    const changes: Change[] = [];

    // Compare components
    const oldComponentIds = new Set(oldState.components.map(c => c.id));
    const newComponentIds = new Set(newState.components.map(c => c.id));

    // Added components
    newState.components.forEach(component => {
      if (!oldComponentIds.has(component.id)) {
        changes.push({
          type: 'add',
          entityType: 'component',
          entityId: component.id,
          newValue: component,
          description: `Added component: ${component.name}`
        });
      }
    });

    // Removed components
    oldState.components.forEach(component => {
      if (!newComponentIds.has(component.id)) {
        changes.push({
          type: 'delete',
          entityType: 'component',
          entityId: component.id,
          oldValue: component,
          description: `Removed component: ${component.name}`
        });
      }
    });

    // Modified components (simplified check)
    newState.components.forEach(newComp => {
      const oldComp = oldState.components.find(c => c.id === newComp.id);
      if (oldComp && JSON.stringify(oldComp) !== JSON.stringify(newComp)) {
        changes.push({
          type: 'modify',
          entityType: 'component',
          entityId: newComp.id,
          oldValue: oldComp,
          newValue: newComp,
          description: `Modified component: ${newComp.name}`
        });
      }
    });

    return changes;
  }

  private getProjectTemplate(templateId: string): Project {
    // Return a mock template
    return {
      id: templateId,
      name: 'Arduino Basic Template',
      description: 'Basic Arduino project template',
      owner: this.currentUser!,
      collaborators: [],
      components: [],
      wires: [],
      nets: [],
      version: '1.0.0',
      lastModified: Date.now(),
      status: 'draft',
      tags: ['arduino', 'basic'],
      permissions: {
        allowPublicView: true,
        allowPublicEdit: false,
        requireApproval: false,
        allowedDomains: []
      }
    };
  }

  private calculateComplexityScore(project: Project): number {
    const componentScore = project.components.length * 0.1;
    const connectionScore = (project.wires.length + project.nets.length) * 0.05;
    const collaboratorScore = project.collaborators.length * 0.2;

    return Math.min(10, componentScore + connectionScore + collaboratorScore);
  }

  private calculateCollaborationEfficiency(project: Project): number {
    // Simplified efficiency calculation
    const baseEfficiency = 0.8;
    const collaboratorBonus = Math.min(0.2, project.collaborators.length * 0.05);

    return baseEfficiency + collaboratorBonus;
  }

  setCurrentUser(user: User): void {
    this.currentUser = user;
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  getAllProjects(): Project[] {
    return Array.from(this.projects.values());
  }

  getActiveSessions(): RealTimeSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }
}

export const collaborationService = new CollaborationService();