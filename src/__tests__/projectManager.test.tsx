import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ProjectManager from '../components/ProjectManager'
import { offlineProjectStore } from '../lib/offlineProjectStore'
import { vcsService } from '../lib/vcs/vcsService'
import { supabase } from '../lib/supabase'

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: vi.fn() },
}))

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

const selectChain = (result: { data: unknown; error: unknown }) => ({
  select: () => ({ order: () => Promise.resolve(result) }),
})

const renderManager = (overrides: {
  onSelectProject?: (project: unknown) => void
  onNewProject?: () => void
  offlineMode?: boolean
} = {}) => {
  const onSelectProject = overrides.onSelectProject ?? vi.fn()
  const onNewProject = overrides.onNewProject ?? vi.fn()
  const utils = render(
    <ProjectManager
      onSelectProject={onSelectProject as never}
      onNewProject={onNewProject}
      offlineMode={overrides.offlineMode ?? true}
    />
  )
  return { ...utils, onSelectProject, onNewProject }
}

describe('ProjectManager (offline)', () => {
  beforeEach(() => {
    localStorage.clear()
    // The VCS service is a module singleton with an in-memory repo map.
    vcsService.reset()
    fromMock.mockReset()
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

  it('states the commit history each project really has on this device', async () => {
    const committed = offlineProjectStore.create('user-1', 'Buck Converter')
    offlineProjectStore.create('user-1', 'Never Committed')
    vcsService.initRepo(committed.id)
    vcsService.commit(committed.id, 'baseline', { components: [], wires: [] })

    renderManager()
    await screen.findByText('Buck Converter')

    // A count, not "Owner": the card states a fact the engineer can act on, and
    // says plainly when a project has no local history at all.
    expect(screen.getByText('1 local revision · main')).toBeInTheDocument()
    expect(screen.getByTitle('1 commit on branch main, stored in this browser')).toBeInTheDocument()
    expect(screen.getByText('Never Committed')).toBeInTheDocument()
    expect(screen.getAllByText('No local history')).toHaveLength(1)
  })
})

describe('ProjectManager (cloud workspace)', () => {
  beforeEach(() => {
    localStorage.clear()
    vcsService.reset()
    fromMock.mockReset()
  })

  it('names a failed read as a failure and retries instead of inviting a new project', async () => {
    fromMock.mockReturnValue(
      selectChain({ data: null, error: new Error('row-level security blocked the read') }),
    )
    renderManager({ offlineMode: false })

    expect(await screen.findByRole('heading', { name: /could not be read/i })).toBeInTheDocument()
    expect(screen.getByText(/row-level security/i)).toBeInTheDocument()
    // The first-run invitation would be a claim that no projects exist.
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create Project' })).not.toBeInTheDocument()

    fromMock.mockReturnValue(
      selectChain({
        data: [{
          id: 'cloud-1',
          user_id: 'user-1',
          name: 'Recovered Board',
          description: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        error: null,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() =>
      expect(screen.getByText('Recovered Board')).toBeInTheDocument(),
    )
    expect(screen.queryByRole('heading', { name: /could not be read/i })).not.toBeInTheDocument()
  })
})
