import React from 'react'
import { useAuthStore, useUIStore, useProjectStore } from '../../stores'
import AuthForm from '../AuthForm'
import ProjectManager from '../ProjectManager'
import { LoadingSpinner } from '../ui/LoadingSpinner'

export const AppLayout: React.FC = () => {
  const { user, isLoading, isAuthenticated } = useAuthStore()
  const { dialogs } = useUIStore()
  const { currentProject, setCurrentProject } = useProjectStore()

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  // Show auth form if not authenticated
  if (!isAuthenticated || !user) {
    return <AuthForm onAuthSuccess={() => {}} />
  }

  // Show project manager if no current project or dialog is open
  if (!currentProject || dialogs.projectManager) {
    return (
      <ProjectManager
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSelectProject={(project) => setCurrentProject(project as any)}
        onNewProject={() => {
          // Handle new project creation
          console.log('New project creation')
        }}
      />
    )
  }

  // Main application - for now return a placeholder
  // This will be implemented in the next step
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Circuit CAD Pro</h1>
        <p className="text-muted-foreground">Main workspace coming soon...</p>
      </div>
    </div>
  )
}