import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ProjectManager from '../components/ProjectManager'
import { offlineProjectStore } from '../lib/offlineProjectStore'

const renderManager = (overrides: {
  onSelectProject?: (project: unknown) => void
  onNewProject?: () => void
} = {}) => {
  const onSelectProject = overrides.onSelectProject ?? vi.fn()
  const onNewProject = overrides.onNewProject ?? vi.fn()
  const utils = render(
    <ProjectManager
      onSelectProject={onSelectProject as never}
      onNewProject={onNewProject}
      offlineMode
    />
  )
  return { ...utils, onSelectProject, onNewProject }
}

describe('ProjectManager (offline)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the first-run empty state and wires both create entry points', async () => {
    const { onNewProject } = renderManager()

    expect(
      await screen.findByRole('heading', { name: 'Your Projects' })
    ).toBeInTheDocument()
    expect(screen.getByText('No projects yet')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New Project' }))
    expect(onNewProject).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))
    expect(onNewProject).toHaveBeenCalledTimes(2)
  })

  it('lists stored projects and filters them through the search box', async () => {
    offlineProjectStore.create('user-1', 'Oscilloscope Frontend')
    offlineProjectStore.create('user-1', 'Robot Arm Controller')
    renderManager()

    expect(await screen.findByText('Oscilloscope Frontend')).toBeInTheDocument()
    expect(screen.getByText('Robot Arm Controller')).toBeInTheDocument()

    const search = screen.getByPlaceholderText('Search projects...')
    fireEvent.change(search, { target: { value: 'oscillo' } })
    expect(screen.getByText('Oscilloscope Frontend')).toBeInTheDocument()
    expect(screen.queryByText('Robot Arm Controller')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'no-such-project' } })
    expect(screen.getByText('No projects found')).toBeInTheDocument()
    // Empty-filtered state must not offer the "Create Project" shortcut
    expect(
      screen.queryByRole('button', { name: 'Create Project' })
    ).not.toBeInTheDocument()
  })

  it('selects a project on card click without triggering delete', async () => {
    offlineProjectStore.create('user-1', 'Legacy Board')
    const { onSelectProject } = renderManager()

    fireEvent.click(await screen.findByText('Legacy Board'))
    expect(onSelectProject).toHaveBeenCalledTimes(1)
    expect(onSelectProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Legacy Board' })
    )
  })

  it('deletes a project only after explicit confirmation', async () => {
    offlineProjectStore.create('user-1', 'Legacy Board')
    const { onSelectProject } = renderManager()

    const deleteButton = await screen.findByRole('button', {
      name: 'Delete Legacy Board',
    })

    // Declined confirmation keeps the project and does not select the card.
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(deleteButton)
    expect(screen.getByText('Legacy Board')).toBeInTheDocument()
    expect(onSelectProject).not.toHaveBeenCalled()

    // Accepted confirmation removes it from the list and from storage.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(deleteButton)
    expect(screen.queryByText('Legacy Board')).not.toBeInTheDocument()
    expect(onSelectProject).not.toHaveBeenCalled()
    expect(
      JSON.parse(localStorage.getItem('folio.offlineProjects') || '[]')
    ).toHaveLength(0)
  })
})
