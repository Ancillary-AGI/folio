import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { 
  X, 
  GitBranch, 
  GitCommit, 
  GitMerge, 
  Tag, 
  History, 
  Plus,
  Check,
  AlertTriangle,
  Clock,
  User,
  MessageSquare,
  ArrowRight,
  RotateCcw,
  Download,
  Upload
} from 'lucide-react';
import { versionControl, type VersionCommit, type VersionBranch, type VersionTag, type VersionChange } from '../../lib/version-control/versionControl';
import type { Project } from '../../types';

interface VersionControlPanelProps {
  onClose: () => void;
  currentProject: Project | null;
  onProjectUpdate: (project: Project) => void;
}

export default function VersionControlPanel({ onClose, currentProject, onProjectUpdate }: VersionControlPanelProps) {
  const [commits, setCommits] = useState<VersionCommit[]>([]);
  const [branches, setBranches] = useState<VersionBranch[]>([]);
  const [tags, setTags] = useState<VersionTag[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');
  const [stagedChanges, setStagedChanges] = useState<VersionChange[]>([]);
  const [uncommittedChanges, setUncommittedChanges] = useState<VersionChange[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [selectedCommit, setSelectedCommit] = useState<string>('');
  const [author] = useState('Current User'); // This would come from auth

  useEffect(() => {
    if (currentProject) {
      // Initialize version control if not already done
      if (versionControl.getHeadCommit() === null) {
        versionControl.init(currentProject, author);
      } else {
        versionControl.setWorkingDirectory(currentProject);
      }
      
      refreshData();
    }
  }, [currentProject, author]);

  const refreshData = () => {
    setCommits(versionControl.getHistory());
    setBranches(versionControl.getBranches());
    setTags(versionControl.getTags());
    setCurrentBranch(versionControl.getCurrentBranch());
    setStagedChanges(versionControl.getStagedChanges());
    
    if (currentProject) {
      setUncommittedChanges(versionControl.detectChanges(currentProject));
    }
  };

  const handleStageAll = () => {
    if (currentProject) {
      versionControl.stageAll(currentProject);
      refreshData();
    }
  };

  const handleStageChange = (change: VersionChange) => {
    const newStaged = [...stagedChanges, change];
    versionControl.stageChanges(newStaged);
    refreshData();
  };

  const handleUnstageChange = (changeIndex: number) => {
    const newStaged = stagedChanges.filter((_, index) => index !== changeIndex);
    versionControl.stageChanges(newStaged);
    refreshData();
  };

  const handleCommit = () => {
    if (!commitMessage.trim()) {
      alert('Please enter a commit message');
      return;
    }

    try {
      const commitId = versionControl.commit(commitMessage, author);
      setCommitMessage('');
      refreshData();
      console.log('Committed:', commitId);
    } catch (error) {
      alert(`Commit failed: ${error}`);
    }
  };

  const handleCreateBranch = () => {
    if (!newBranchName.trim()) {
      alert('Please enter a branch name');
      return;
    }

    try {
      versionControl.createBranch(newBranchName, author);
      setNewBranchName('');
      setShowNewBranch(false);
      refreshData();
    } catch (error) {
      alert(`Failed to create branch: ${error}`);
    }
  };

  const handleSwitchBranch = (branchName: string) => {
    try {
      const project = versionControl.checkout(branchName);
      onProjectUpdate(project);
      refreshData();
    } catch (error) {
      alert(`Failed to switch branch: ${error}`);
    }
  };

  const handleMergeBranch = (sourceBranch: string) => {
    try {
      const result = versionControl.merge(sourceBranch, author);
      if (result.success) {
        refreshData();
        if (result.mergeCommitId) {
          console.log('Merged successfully:', result.mergeCommitId);
        }
      } else {
        alert(`Merge failed: ${result.error}`);
      }
    } catch (error) {
      alert(`Merge failed: ${error}`);
    }
  };

  const handleResetToCommit = (commitId: string) => {
    if (confirm('Are you sure you want to reset to this commit? This will discard all uncommitted changes.')) {
      try {
        const project = versionControl.reset(commitId, 'hard');
        onProjectUpdate(project);
        refreshData();
      } catch (error) {
        alert(`Reset failed: ${error}`);
      }
    }
  };

  const handleRevertCommit = (commitId: string) => {
    try {
      const revertCommitId = versionControl.revert(commitId, author);
      const project = versionControl.getWorkingDirectory();
      if (project) {
        onProjectUpdate(project);
      }
      refreshData();
      console.log('Reverted commit:', revertCommitId);
    } catch (error) {
      alert(`Revert failed: ${error}`);
    }
  };

  const handleExportRepository = () => {
    const data = versionControl.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `repository_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getChangeTypeIcon = (type: VersionChange['type']) => {
    switch (type) {
      case 'component_added':
      case 'wire_added':
      case 'schematic_added':
        return <Plus className="w-3 h-3 text-green-600" />;
      case 'component_removed':
      case 'wire_removed':
      case 'schematic_removed':
        return <X className="w-3 h-3 text-red-600" />;
      default:
        return <MessageSquare className="w-3 h-3 text-blue-600" />;
    }
  };

  const getChangeTypeColor = (type: VersionChange['type']) => {
    if (type.includes('_added')) return 'text-green-600 bg-green-50 border-green-200';
    if (type.includes('_removed')) return 'text-red-600 bg-red-50 border-red-200';
    return 'text-blue-600 bg-blue-50 border-blue-200';
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex">
        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <GitBranch className="w-5 h-5" />
              Version Control
            </h3>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 flex">
            {/* Left Panel - Changes */}
            <div className="w-1/2 border-r border-border flex flex-col">
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium">Changes</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStageAll}
                    disabled={uncommittedChanges.length === 0}
                  >
                    Stage All
                  </Button>
                </div>

                {/* Commit Section */}
                <div className="space-y-3">
                  <textarea
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Enter commit message..."
                    className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background resize-none"
                    rows={3}
                  />
                  <Button
                    onClick={handleCommit}
                    disabled={stagedChanges.length === 0 || !commitMessage.trim()}
                    className="w-full flex items-center gap-2"
                  >
                    <GitCommit className="w-4 h-4" />
                    Commit ({stagedChanges.length})
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {/* Staged Changes */}
                {stagedChanges.length > 0 && (
                  <div className="p-4 border-b border-border">
                    <h5 className="font-medium text-sm mb-2 text-green-600">Staged Changes ({stagedChanges.length})</h5>
                    <div className="space-y-1">
                      {stagedChanges.map((change, index) => (
                        <div
                          key={index}
                          className={`flex items-center justify-between p-2 rounded text-xs border ${getChangeTypeColor(change.type)}`}
                        >
                          <div className="flex items-center gap-2">
                            {getChangeTypeIcon(change.type)}
                            <span className="font-medium">{change.type.replace('_', ' ')}</span>
                            <span className="text-muted-foreground">{change.objectId}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleUnstageChange(index)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Uncommitted Changes */}
                {uncommittedChanges.length > 0 && (
                  <div className="p-4">
                    <h5 className="font-medium text-sm mb-2 text-orange-600">Uncommitted Changes ({uncommittedChanges.length})</h5>
                    <div className="space-y-1">
                      {uncommittedChanges.map((change, index) => (
                        <div
                          key={index}
                          className={`flex items-center justify-between p-2 rounded text-xs border ${getChangeTypeColor(change.type)}`}
                        >
                          <div className="flex items-center gap-2">
                            {getChangeTypeIcon(change.type)}
                            <span className="font-medium">{change.type.replace('_', ' ')}</span>
                            <span className="text-muted-foreground">{change.objectId}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleStageChange(change)}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {uncommittedChanges.length === 0 && stagedChanges.length === 0 && (
                  <div className="p-4 text-center text-muted-foreground">
                    <Check className="w-8 h-8 mx-auto mb-2 text-green-600" />
                    <p>No changes detected</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel - History & Branches */}
            <div className="w-1/2 flex flex-col">
              <div className="flex border-b border-border">
                <Button
                  variant={showHistory ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setShowHistory(true)}
                  className="rounded-none border-r border-border"
                >
                  <History className="w-4 h-4 mr-2" />
                  History
                </Button>
                <Button
                  variant={!showHistory ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setShowHistory(false)}
                  className="rounded-none"
                >
                  <GitBranch className="w-4 h-4 mr-2" />
                  Branches
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {showHistory ? (
                  /* Commit History */
                  <div className="p-4 space-y-3">
                    {commits.map((commit) => (
                      <div
                        key={commit.id}
                        className={`p-3 rounded border cursor-pointer transition-colors ${
                          selectedCommit === commit.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-accent'
                        }`}
                        onClick={() => setSelectedCommit(commit.id)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <GitCommit className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium text-sm">{commit.message}</span>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResetToCommit(commit.id);
                              }}
                              title="Reset to this commit"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRevertCommit(commit.id);
                              }}
                              title="Revert this commit"
                            >
                              <ArrowRight className="w-3 h-3 rotate-180" />
                            </Button>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {commit.author}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTimestamp(commit.timestamp)}
                          </div>
                          <div className="flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            {commit.changes.length} changes
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground mt-1 font-mono">
                          {commit.id.substring(0, 8)}
                        </div>
                      </div>
                    ))}

                    {commits.length === 0 && (
                      <div className="text-center text-muted-foreground py-8">
                        <History className="w-8 h-8 mx-auto mb-2" />
                        <p>No commits yet</p>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Branches */
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h5 className="font-medium text-sm">Branches</h5>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowNewBranch(true)}
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        New
                      </Button>
                    </div>

                    {showNewBranch && (
                      <div className="p-3 border border-border rounded space-y-2">
                        <input
                          type="text"
                          value={newBranchName}
                          onChange={(e) => setNewBranchName(e.target.value)}
                          placeholder="Branch name"
                          className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleCreateBranch}>
                            Create
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setShowNewBranch(false);
                              setNewBranchName('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {branches.map((branch) => (
                      <div
                        key={branch.id}
                        className={`p-3 rounded border ${
                          currentBranch === branch.name
                            ? 'border-primary bg-primary/5'
                            : 'border-border'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <GitBranch className="w-4 h-4" />
                            <span className="font-medium text-sm">{branch.name}</span>
                            {currentBranch === branch.name && (
                              <span className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded">
                                current
                              </span>
                            )}
                          </div>

                          {currentBranch !== branch.name && (
                            <div className="flex gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleSwitchBranch(branch.name)}
                              >
                                Checkout
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleMergeBranch(branch.name)}
                              >
                                <GitMerge className="w-3 h-3 mr-1" />
                                Merge
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="text-xs text-muted-foreground">
                          Created {formatTimestamp(branch.created)} by {branch.author}
                        </div>

                        {branch.description && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {branch.description}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar - Actions */}
        <div className="w-64 bg-card border-l border-border p-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Repository</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span>Current Branch:</span>
                  <span className="font-medium">{currentBranch}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Commits:</span>
                  <span className="font-medium">{commits.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Branches:</span>
                  <span className="font-medium">{branches.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tags:</span>
                  <span className="font-medium">{tags.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Download className="w-4 h-4" />
                Export/Import
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportRepository}
                className="w-full flex items-center gap-2"
              >
                <Download className="w-3 h-3" />
                Export Repository
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="w-full flex items-center gap-2"
              >
                <Upload className="w-3 h-3" />
                Import Repository
              </Button>
            </CardContent>
          </Card>

          {tags.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  Tags
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {tags.slice(0, 5).map((tag) => (
                  <div key={tag.id} className="text-xs p-2 bg-accent rounded">
                    <div className="font-medium">{tag.name}</div>
                    <div className="text-muted-foreground">{tag.message}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};