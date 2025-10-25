import type { Project, Schematic, PlacedComponent, Wire } from '../../types';

export interface VersionCommit {
  id: string;
  message: string;
  author: string;
  timestamp: number;
  parentId?: string;
  changes: VersionChange[];
  projectSnapshot: Project;
}

export interface VersionChange {
  type: 'component_added' | 'component_removed' | 'component_modified' | 'wire_added' | 'wire_removed' | 'wire_modified' | 'schematic_added' | 'schematic_removed' | 'schematic_modified';
  objectId: string;
  before?: any;
  after?: any;
  path: string[];
}

export interface VersionBranch {
  id: string;
  name: string;
  headCommitId: string;
  created: number;
  author: string;
  description?: string;
}

export interface VersionTag {
  id: string;
  name: string;
  commitId: string;
  message: string;
  author: string;
  timestamp: number;
}

export interface MergeConflict {
  id: string;
  type: 'component' | 'wire' | 'schematic';
  objectId: string;
  path: string[];
  baseVersion: any;
  currentVersion: any;
  incomingVersion: any;
  resolved: boolean;
  resolution?: any;
}

export interface MergeResult {
  success: boolean;
  conflicts: MergeConflict[];
  mergeCommitId?: string;
  error?: string;
}

class VersionControlSystem {
  private commits: Map<string, VersionCommit> = new Map();
  private branches: Map<string, VersionBranch> = new Map();
  private tags: Map<string, VersionTag> = new Map();
  private currentBranch: string = 'main';
  private workingDirectory: Project | null = null;
  private stagedChanges: VersionChange[] = [];

  constructor() {
    // Initialize with main branch
    this.branches.set('main', {
      id: 'main',
      name: 'main',
      headCommitId: '',
      created: Date.now(),
      author: 'system'
    });
  }

  // Initialize repository with initial commit
  init(project: Project, author: string): string {
    const initialCommit: VersionCommit = {
      id: this.generateId(),
      message: 'Initial commit',
      author,
      timestamp: Date.now(),
      changes: [],
      projectSnapshot: JSON.parse(JSON.stringify(project))
    };

    this.commits.set(initialCommit.id, initialCommit);
    
    const mainBranch = this.branches.get('main')!;
    mainBranch.headCommitId = initialCommit.id;
    
    this.workingDirectory = JSON.parse(JSON.stringify(project));
    
    return initialCommit.id;
  }

  // Set working directory
  setWorkingDirectory(project: Project): void {
    this.workingDirectory = JSON.parse(JSON.stringify(project));
  }

  // Get current working directory
  getWorkingDirectory(): Project | null {
    return this.workingDirectory ? JSON.parse(JSON.stringify(this.workingDirectory)) : null;
  }

  // Detect changes between current state and last commit
  detectChanges(currentProject: Project): VersionChange[] {
    if (!this.workingDirectory) return [];

    const changes: VersionChange[] = [];
    const lastCommit = this.getHeadCommit();
    const lastProject = lastCommit?.projectSnapshot;

    if (!lastProject) return [];

    // Compare schematics
    currentProject.schematics.forEach((schematic, index) => {
      const lastSchematic = lastProject.schematics.find(s => s.id === schematic.id);
      
      if (!lastSchematic) {
        changes.push({
          type: 'schematic_added',
          objectId: schematic.id,
          after: schematic,
          path: ['schematics', index.toString()]
        });
      } else if (JSON.stringify(schematic) !== JSON.stringify(lastSchematic)) {
        changes.push({
          type: 'schematic_modified',
          objectId: schematic.id,
          before: lastSchematic,
          after: schematic,
          path: ['schematics', index.toString()]
        });

        // Detect component changes within schematic
        this.detectComponentChanges(schematic, lastSchematic, changes, ['schematics', index.toString()]);
        this.detectWireChanges(schematic, lastSchematic, changes, ['schematics', index.toString()]);
      }
    });

    // Check for removed schematics
    lastProject.schematics.forEach(lastSchematic => {
      if (!currentProject.schematics.find(s => s.id === lastSchematic.id)) {
        changes.push({
          type: 'schematic_removed',
          objectId: lastSchematic.id,
          before: lastSchematic,
          path: ['schematics']
        });
      }
    });

    return changes;
  }

  private detectComponentChanges(current: Schematic, last: Schematic, changes: VersionChange[], basePath: string[]): void {
    // Added components
    current.components.forEach((component, index) => {
      const lastComponent = last.components.find(c => c.id === component.id);
      
      if (!lastComponent) {
        changes.push({
          type: 'component_added',
          objectId: component.id,
          after: component,
          path: [...basePath, 'components', index.toString()]
        });
      } else if (JSON.stringify(component) !== JSON.stringify(lastComponent)) {
        changes.push({
          type: 'component_modified',
          objectId: component.id,
          before: lastComponent,
          after: component,
          path: [...basePath, 'components', index.toString()]
        });
      }
    });

    // Removed components
    last.components.forEach(lastComponent => {
      if (!current.components.find(c => c.id === lastComponent.id)) {
        changes.push({
          type: 'component_removed',
          objectId: lastComponent.id,
          before: lastComponent,
          path: [...basePath, 'components']
        });
      }
    });
  }

  private detectWireChanges(current: Schematic, last: Schematic, changes: VersionChange[], basePath: string[]): void {
    // Added wires
    current.wires.forEach((wire, index) => {
      const lastWire = last.wires.find(w => w.id === wire.id);
      
      if (!lastWire) {
        changes.push({
          type: 'wire_added',
          objectId: wire.id,
          after: wire,
          path: [...basePath, 'wires', index.toString()]
        });
      } else if (JSON.stringify(wire) !== JSON.stringify(lastWire)) {
        changes.push({
          type: 'wire_modified',
          objectId: wire.id,
          before: lastWire,
          after: wire,
          path: [...basePath, 'wires', index.toString()]
        });
      }
    });

    // Removed wires
    last.wires.forEach(lastWire => {
      if (!current.wires.find(w => w.id === lastWire.id)) {
        changes.push({
          type: 'wire_removed',
          objectId: lastWire.id,
          before: lastWire,
          path: [...basePath, 'wires']
        });
      }
    });
  }

  // Stage changes for commit
  stageChanges(changes: VersionChange[]): void {
    this.stagedChanges = [...changes];
  }

  // Stage all changes
  stageAll(currentProject: Project): void {
    const changes = this.detectChanges(currentProject);
    this.stageChanges(changes);
  }

  // Get staged changes
  getStagedChanges(): VersionChange[] {
    return [...this.stagedChanges];
  }

  // Commit staged changes
  commit(message: string, author: string): string {
    if (this.stagedChanges.length === 0) {
      throw new Error('No changes staged for commit');
    }

    if (!this.workingDirectory) {
      throw new Error('No working directory set');
    }

    const parentCommit = this.getHeadCommit();
    
    const commit: VersionCommit = {
      id: this.generateId(),
      message,
      author,
      timestamp: Date.now(),
      parentId: parentCommit?.id,
      changes: [...this.stagedChanges],
      projectSnapshot: JSON.parse(JSON.stringify(this.workingDirectory))
    };

    this.commits.set(commit.id, commit);
    
    // Update current branch head
    const currentBranch = this.branches.get(this.currentBranch)!;
    currentBranch.headCommitId = commit.id;

    // Clear staged changes
    this.stagedChanges = [];

    return commit.id;
  }

  // Create new branch
  createBranch(name: string, author: string, description?: string): string {
    if (this.branches.has(name)) {
      throw new Error(`Branch '${name}' already exists`);
    }

    const headCommit = this.getHeadCommit();
    if (!headCommit) {
      throw new Error('No commits found to branch from');
    }

    const branch: VersionBranch = {
      id: name,
      name,
      headCommitId: headCommit.id,
      created: Date.now(),
      author,
      description
    };

    this.branches.set(name, branch);
    return name;
  }

  // Switch to branch
  checkout(branchName: string): Project {
    const branch = this.branches.get(branchName);
    if (!branch) {
      throw new Error(`Branch '${branchName}' not found`);
    }

    this.currentBranch = branchName;
    
    const headCommit = this.commits.get(branch.headCommitId);
    if (!headCommit) {
      throw new Error(`Head commit not found for branch '${branchName}'`);
    }

    this.workingDirectory = JSON.parse(JSON.stringify(headCommit.projectSnapshot));
    return this.workingDirectory;
  }

  // Merge branch into current branch
  merge(sourceBranch: string, author: string, message?: string): MergeResult {
    const source = this.branches.get(sourceBranch);
    const target = this.branches.get(this.currentBranch);

    if (!source || !target) {
      return {
        success: false,
        conflicts: [],
        error: 'Source or target branch not found'
      };
    }

    const sourceCommit = this.commits.get(source.headCommitId);
    const targetCommit = this.commits.get(target.headCommitId);

    if (!sourceCommit || !targetCommit) {
      return {
        success: false,
        conflicts: [],
        error: 'Source or target commit not found'
      };
    }

    // Find common ancestor
    const commonAncestor = this.findCommonAncestor(sourceCommit.id, targetCommit.id);
    
    // Detect conflicts
    const conflicts = this.detectMergeConflicts(
      commonAncestor?.projectSnapshot,
      targetCommit.projectSnapshot,
      sourceCommit.projectSnapshot
    );

    if (conflicts.length > 0) {
      return {
        success: false,
        conflicts,
        error: 'Merge conflicts detected'
      };
    }

    // Perform merge
    const mergedProject = this.performMerge(
      targetCommit.projectSnapshot,
      sourceCommit.projectSnapshot
    );

    // Create merge commit
    const mergeCommit: VersionCommit = {
      id: this.generateId(),
      message: message || `Merge branch '${sourceBranch}' into '${this.currentBranch}'`,
      author,
      timestamp: Date.now(),
      parentId: targetCommit.id,
      changes: this.detectChanges(mergedProject),
      projectSnapshot: mergedProject
    };

    this.commits.set(mergeCommit.id, mergeCommit);
    target.headCommitId = mergeCommit.id;
    this.workingDirectory = mergedProject;

    return {
      success: true,
      conflicts: [],
      mergeCommitId: mergeCommit.id
    };
  }

  private findCommonAncestor(commitId1: string, commitId2: string): VersionCommit | null {
    const ancestors1 = this.getAncestors(commitId1);
    const ancestors2 = this.getAncestors(commitId2);

    for (const ancestor1 of ancestors1) {
      if (ancestors2.includes(ancestor1)) {
        return this.commits.get(ancestor1) || null;
      }
    }

    return null;
  }

  private getAncestors(commitId: string): string[] {
    const ancestors: string[] = [];
    let current = this.commits.get(commitId);

    while (current && current.parentId) {
      ancestors.push(current.parentId);
      current = this.commits.get(current.parentId);
    }

    return ancestors;
  }

  private detectMergeConflicts(base: Project | undefined, current: Project, incoming: Project): MergeConflict[] {
    const conflicts: MergeConflict[] = [];

    if (!base) return conflicts;

    // Check for conflicting component changes
    current.schematics.forEach((currentSchematic, schematicIndex) => {
      const incomingSchematic = incoming.schematics.find(s => s.id === currentSchematic.id);
      const baseSchematic = base.schematics.find(s => s.id === currentSchematic.id);

      if (incomingSchematic && baseSchematic) {
        currentSchematic.components.forEach(currentComponent => {
          const incomingComponent = incomingSchematic.components.find(c => c.id === currentComponent.id);
          const baseComponent = baseSchematic.components.find(c => c.id === currentComponent.id);

          if (incomingComponent && baseComponent) {
            // Check if both branches modified the same component differently
            const currentChanged = JSON.stringify(currentComponent) !== JSON.stringify(baseComponent);
            const incomingChanged = JSON.stringify(incomingComponent) !== JSON.stringify(baseComponent);

            if (currentChanged && incomingChanged && 
                JSON.stringify(currentComponent) !== JSON.stringify(incomingComponent)) {
              conflicts.push({
                id: this.generateId(),
                type: 'component',
                objectId: currentComponent.id,
                path: ['schematics', schematicIndex.toString(), 'components'],
                baseVersion: baseComponent,
                currentVersion: currentComponent,
                incomingVersion: incomingComponent,
                resolved: false
              });
            }
          }
        });
      }
    });

    return conflicts;
  }

  private performMerge(target: Project, source: Project): Project {
    // Simple merge strategy - prefer source changes
    const merged = JSON.parse(JSON.stringify(target));

    source.schematics.forEach(sourceSchematic => {
      const targetSchematicIndex = merged.schematics.findIndex(s => s.id === sourceSchematic.id);
      
      if (targetSchematicIndex >= 0) {
        // Merge schematic
        merged.schematics[targetSchematicIndex] = JSON.parse(JSON.stringify(sourceSchematic));
      } else {
        // Add new schematic
        merged.schematics.push(JSON.parse(JSON.stringify(sourceSchematic)));
      }
    });

    return merged;
  }

  // Create tag
  createTag(name: string, commitId: string, message: string, author: string): string {
    if (this.tags.has(name)) {
      throw new Error(`Tag '${name}' already exists`);
    }

    if (!this.commits.has(commitId)) {
      throw new Error(`Commit '${commitId}' not found`);
    }

    const tag: VersionTag = {
      id: name,
      name,
      commitId,
      message,
      author,
      timestamp: Date.now()
    };

    this.tags.set(name, tag);
    return name;
  }

  // Get commit history
  getHistory(branchName?: string, limit?: number): VersionCommit[] {
    const branch = this.branches.get(branchName || this.currentBranch);
    if (!branch) return [];

    const history: VersionCommit[] = [];
    let current = this.commits.get(branch.headCommitId);
    let count = 0;

    while (current && (!limit || count < limit)) {
      history.push(current);
      current = current.parentId ? this.commits.get(current.parentId) : undefined;
      count++;
    }

    return history;
  }

  // Get current branch
  getCurrentBranch(): string {
    return this.currentBranch;
  }

  // Get all branches
  getBranches(): VersionBranch[] {
    return Array.from(this.branches.values());
  }

  // Get all tags
  getTags(): VersionTag[] {
    return Array.from(this.tags.values());
  }

  // Get head commit of current branch
  getHeadCommit(): VersionCommit | null {
    const branch = this.branches.get(this.currentBranch);
    return branch ? this.commits.get(branch.headCommitId) || null : null;
  }

  // Get commit by ID
  getCommit(commitId: string): VersionCommit | null {
    return this.commits.get(commitId) || null;
  }

  // Reset to commit
  reset(commitId: string, mode: 'soft' | 'hard' = 'soft'): Project {
    const commit = this.commits.get(commitId);
    if (!commit) {
      throw new Error(`Commit '${commitId}' not found`);
    }

    if (mode === 'hard') {
      // Reset working directory and clear staged changes
      this.workingDirectory = JSON.parse(JSON.stringify(commit.projectSnapshot));
      this.stagedChanges = [];
    }

    // Update branch head
    const branch = this.branches.get(this.currentBranch)!;
    branch.headCommitId = commitId;

    return this.workingDirectory!;
  }

  // Revert commit
  revert(commitId: string, author: string): string {
    const commit = this.commits.get(commitId);
    if (!commit) {
      throw new Error(`Commit '${commitId}' not found`);
    }

    if (!this.workingDirectory) {
      throw new Error('No working directory set');
    }

    // Create inverse changes
    const inverseChanges: VersionChange[] = commit.changes.map(change => ({
      ...change,
      type: this.getInverseChangeType(change.type),
      before: change.after,
      after: change.before
    }));

    // Apply inverse changes to working directory
    const revertedProject = this.applyChanges(this.workingDirectory, inverseChanges);
    
    // Stage and commit the revert
    this.workingDirectory = revertedProject;
    this.stageChanges(this.detectChanges(revertedProject));
    
    return this.commit(`Revert "${commit.message}"`, author);
  }

  private getInverseChangeType(type: VersionChange['type']): VersionChange['type'] {
    switch (type) {
      case 'component_added': return 'component_removed';
      case 'component_removed': return 'component_added';
      case 'wire_added': return 'wire_removed';
      case 'wire_removed': return 'wire_added';
      case 'schematic_added': return 'schematic_removed';
      case 'schematic_removed': return 'schematic_added';
      default: return type;
    }
  }

  private applyChanges(project: Project, changes: VersionChange[]): Project {
    const result = JSON.parse(JSON.stringify(project));
    
    changes.forEach(change => {
      // Apply change based on type and path
      // This is a simplified implementation
      if (change.type.includes('_removed') && change.before) {
        // Add back removed item
        this.addItemAtPath(result, change.path, change.before);
      } else if (change.type.includes('_added') && change.after) {
        // Remove added item
        this.removeItemAtPath(result, change.path, change.after);
      }
    });

    return result;
  }

  private addItemAtPath(obj: any, path: string[], item: any): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      current = current[path[i]];
    }
    
    const lastKey = path[path.length - 1];
    if (Array.isArray(current[lastKey])) {
      current[lastKey].push(item);
    }
  }

  private removeItemAtPath(obj: any, path: string[], item: any): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      current = current[path[i]];
    }
    
    const lastKey = path[path.length - 1];
    if (Array.isArray(current[lastKey])) {
      const index = current[lastKey].findIndex((x: any) => x.id === item.id);
      if (index >= 0) {
        current[lastKey].splice(index, 1);
      }
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }

  // Export repository data
  export(): any {
    return {
      commits: Array.from(this.commits.entries()),
      branches: Array.from(this.branches.entries()),
      tags: Array.from(this.tags.entries()),
      currentBranch: this.currentBranch
    };
  }

  // Import repository data
  import(data: any): void {
    this.commits = new Map(data.commits);
    this.branches = new Map(data.branches);
    this.tags = new Map(data.tags);
    this.currentBranch = data.currentBranch;
  }
}

export const versionControl = new VersionControlSystem();