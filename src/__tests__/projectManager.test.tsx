import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
  onProjectRenamed?: (project: unknown) => void
  offlineMode?: boolean
  onBriefSubmit?: (brief: string, scaffold: 'electronics' | 'embedded') => void
} = {}) => {
  const onSelectProject = overrides.onSelectProject ?? vi.fn()
  const onNewProject = overrides.onNewProject ?? vi.fn()
  const onProjectRenamed = overrides.onProjectRenamed ?? vi.fn()
  const onBriefSubmit = overrides.onBriefSubmit ?? vi.fn()
  const utils = render(
    <ProjectManager
      onSelectProject={onSelectProject as never}
      onNewProject={onNewProject}
      onBriefSubmit={onBriefSubmit}
      onProjectRenamed={onProjectRenamed as never}
      offlineMode={overrides.offlineMode ?? true}
    />
  )
  return { ...utils, onSelectProject, onNewProject, onProjectRenamed, onBriefSubmit }
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
      await screen.findByRole('heading', { name: 'From first sketch to verified build.' })
    ).toBeInTheDocument()
    expect(screen.getByText('No projects yet')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New Project' }))
    expect(onNewProject).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))
    expect(onNewProject).toHaveBeenCalledTimes(2)
  })

  it('submits a brief from the composer with the chosen scaffold', async () => {
    const onBriefSubmit = vi.fn()
    renderManager({ onBriefSubmit })

    const brief = screen.getByRole('textbox', { name: 'Describe your project' })
    // A one-character brief is not a project yet.
    expect(screen.getByRole('button', { name: 'Create from brief' })).toBeDisabled()

    fireEvent.change(brief, { target: { value: 'USB-C buck converter, 3.3 V at 2 A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Electronics + firmware' }))
    expect(screen.getByRole('button', { name: 'Electronics + firmware' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Create from brief' }))
    expect(onBriefSubmit).toHaveBeenCalledTimes(1)
    expect(onBriefSubmit).toHaveBeenCalledWith('USB-C buck converter, 3.3 V at 2 A', 'embedded')
    // The composer clears after submitting so the next project starts clean.
    expect(screen.getByRole('textbox', { name: 'Describe your project' })).toHaveValue('')
  })

  it('fills the composer from an example chip instead of submitting it', () => {
    const onBriefSubmit = vi.fn()
    renderManager({ onBriefSubmit })

    fireEvent.click(screen.getByRole('button', { name: 'ESP32 plant monitor, BME280 over I2C' }))
    expect(screen.getByRole('textbox', { name: 'Describe your project' })).toHaveValue('ESP32 plant monitor, BME280 over I2C')
    expect(onBriefSubmit).not.toHaveBeenCalled()
  })

  it('lists stored projects and filters them through the search box', async () => {
    offlineProjectStore.create('user-1', 'Oscilloscope Frontend')
    offlineProjectStore.create('user-1', 'Robot Arm Controller')
    renderManager()

    expect(await screen.findByText('Oscilloscope Frontend')).toBeInTheDocument()
    expect(screen.getByText('Robot Arm Controller')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Pick up where you left off' }).compareDocumentPosition(
        screen.getByRole('heading', { name: 'Start in a family' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    const search = screen.getByRole('textbox', { name: 'Search projects' })
    fireEvent.change(search, { target: { value: 'oscillo' } })
    expect(screen.getByText('Oscilloscope Frontend')).toBeInTheDocument()
    expect(screen.queryByText('Robot Arm Controller')).not.toBeInTheDocument()
    // The field reports how much of the library the current term matched.
    expect(screen.getByText('1/2')).toBeInTheDocument()

    // A term that matches nothing is stated, not silently shown as an empty grid.
    fireEvent.change(search, { target: { value: 'no-such-project' } })
    expect(screen.getByText('No projects found')).toBeInTheDocument()
    expect(screen.getByText('0/2')).toBeInTheDocument()
    // Empty-filtered state must not offer the "Create Project" shortcut
    expect(
      screen.queryByRole('button', { name: 'Create Project' })
    ).not.toBeInTheDocument()

    // Clearing the search is a named control, and it restores the whole list.
    fireEvent.click(screen.getByRole('button', { name: 'Clear project search' }))
    expect(screen.getByRole('textbox', { name: 'Search projects' })).toHaveValue('')
    expect(screen.getByText('Robot Arm Controller')).toBeInTheDocument()
    expect(screen.queryByText('1/2')).not.toBeInTheDocument()
  })

  it('selects a project on card click without triggering delete', async () => {
    offlineProjectStore.create('user-1', 'Legacy Board')
    const { onSelectProject } = renderManager()

    // Anywhere on the card but the name is the open gesture; the name itself
    // belongs to the rename, and is covered there.
    const card = (await screen.findByText('Legacy Board')).closest('.project-card')
    fireEvent.click(card as Element)
    expect(onSelectProject).toHaveBeenCalledTimes(1)
    expect(onSelectProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Legacy Board' })
    )
  })

  it('deletes a project only after the panel asks and the answer is yes', async () => {
    offlineProjectStore.create('user-1', 'Legacy Board')
    const { onSelectProject } = renderManager()

    const deleteButton = await screen.findByRole('button', {
      name: 'Delete Legacy Board',
    })
    // The word is on the control, not only in its accessible name: an icon
    // parked in a card corner is decoration until it is far too late.
    expect(deleteButton).toHaveTextContent('Delete')

    /*
     * The question is part of the app now, so the test answers it the way a
     * person does. Declining must write nothing and must not open the card, and
     * the panel has to state the thing that is actually at risk: the history and
     * backups that go with the row.
     */
    fireEvent.click(deleteButton)
    const question = await screen.findByRole('dialog', { name: /Delete “Legacy Board”/i })
    expect(within(question).getByText(/version history and the backups stored with it/i)).toBeInTheDocument()
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Legacy Board')).toBeInTheDocument()
    expect(onSelectProject).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('folio.offlineProjects') || '[]')).toHaveLength(1)

    // Answering yes removes it from the list and from storage.
    fireEvent.click(deleteButton)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete project' }))
    await waitFor(() => expect(screen.queryByText('Legacy Board')).not.toBeInTheDocument())
    expect(onSelectProject).not.toHaveBeenCalled()
    expect(
      JSON.parse(localStorage.getItem('folio.offlineProjects') || '[]')
    ).toHaveLength(0)
  })

  it('renames a project by clicking its title, and clicking away accepts', async () => {
    const project = offlineProjectStore.create('user-1', 'Legacy Board')
    const { onSelectProject, onProjectRenamed } = renderManager()

    // The name is the control, so pressing it must not also open the project.
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Legacy Board' }))
    expect(onSelectProject).not.toHaveBeenCalled()

    const field = screen.getByRole('textbox', { name: 'New name for Legacy Board' })
    // Once the field is open it is still the name, not the card: a click inside
    // it must not fall through and navigate away mid-edit.
    fireEvent.click(field)
    expect(onSelectProject).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '  Amplifier Rev B  ' } })
    fireEvent.blur(field)

    await waitFor(() => expect(screen.getByText('Amplifier Rev B')).toBeInTheDocument())
    expect(screen.queryByRole('textbox', { name: 'New name for Amplifier Rev B' })).not.toBeInTheDocument()
    expect(onSelectProject).not.toHaveBeenCalled()
    expect(onProjectRenamed).toHaveBeenCalledWith(expect.objectContaining({ id: project.id, name: 'Amplifier Rev B' }))
    expect(offlineProjectStore.get(project.id)?.name).toBe('Amplifier Rev B')
  })

  it('accepts the typed name on Enter too', async () => {
    const project = offlineProjectStore.create('user-1', 'Legacy Board')
    const { onProjectRenamed } = renderManager()

    fireEvent.click(await screen.findByRole('button', { name: 'Rename Legacy Board' }))
    const field = screen.getByRole('textbox', { name: 'New name for Legacy Board' })
    fireEvent.change(field, { target: { value: 'Amplifier Rev C' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('Amplifier Rev C')).toBeInTheDocument())
    expect(offlineProjectStore.get(project.id)?.name).toBe('Amplifier Rev C')
    expect(onProjectRenamed).toHaveBeenCalledTimes(1)
  })

  it('keeps the old name when the rename is cancelled or blank', async () => {
    const project = offlineProjectStore.create('user-1', 'Legacy Board')
    const { onProjectRenamed } = renderManager()

    // Escape abandons the edit.
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Legacy Board' }))
    const field = screen.getByRole('textbox', { name: 'New name for Legacy Board' })
    fireEvent.change(field, { target: { value: 'Half Typed' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(await screen.findByText('Legacy Board')).toBeInTheDocument()
    expect(offlineProjectStore.get(project.id)?.name).toBe('Legacy Board')

    // A name that is only whitespace is not a name, so nothing is written — and
    // the card says so rather than quietly showing the old title.
    fireEvent.click(screen.getByRole('button', { name: 'Rename Legacy Board' }))
    const blank = screen.getByRole('textbox', { name: 'New name for Legacy Board' })
    fireEvent.change(blank, { target: { value: '   ' } })
    fireEvent.blur(blank)

    expect(await screen.findByRole('alert')).toHaveTextContent(/kept the old one/)
    expect(screen.getByText('Legacy Board')).toBeInTheDocument()
    expect(offlineProjectStore.get(project.id)?.name).toBe('Legacy Board')
    expect(onProjectRenamed).not.toHaveBeenCalled()
  })

  it('starts a project in the family whose tile was pressed', async () => {
    const onNewProject = vi.fn()
    renderManager({ onNewProject })
    await screen.findByRole('heading', { name: 'From first sketch to verified build.' })

    fireEvent.click(screen.getByRole('button', { name: /^Start a project in the Mechanical family/ }))
    expect(onNewProject).toHaveBeenCalledWith('mechanical')

    // The plain button still creates without picking a family.
    fireEvent.click(screen.getByRole('button', { name: 'New Project' }))
    expect(onNewProject).toHaveBeenCalledTimes(2)
    expect(onNewProject.mock.calls[1]?.[0]).toBeUndefined()
  })

  it('states the commit history each project really has in the workspace', async () => {
    const committed = offlineProjectStore.create('user-1', 'Buck Converter')
    offlineProjectStore.create('user-1', 'Never Committed')
    vcsService.initRepo(committed.id)
    vcsService.commit(committed.id, 'baseline', { components: [], wires: [] })

    renderManager()
    await screen.findByText('Buck Converter')

    // A count, not "Owner": the card states a fact the engineer can act on, and
    // says plainly when a project has no local history at all.
    expect(screen.getByText('1 revision · main')).toBeInTheDocument()
    expect(screen.getByTitle('1 commit on branch main, stored with the project')).toBeInTheDocument()
    expect(screen.getByText('Never Committed')).toBeInTheDocument()
    expect(screen.getAllByText('No revisions yet')).toHaveLength(1)
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

  it('writes a rename to the project row and tells the shell', async () => {
    const iso = new Date().toISOString()
    const row = { id: 'cloud-1', user_id: 'user-1', name: 'Recovered Board', description: '', created_at: iso, updated_at: iso }
    const eqMock = vi.fn(() => Promise.resolve({ data: null, error: null }))
    const updateMock = vi.fn(() => ({ eq: eqMock }))
    fromMock.mockImplementation(() => ({
      select: () => ({ order: () => Promise.resolve({ data: [row], error: null }) }),
      update: updateMock,
    }))
    const { onProjectRenamed } = renderManager({ offlineMode: false })

    fireEvent.click(await screen.findByRole('button', { name: 'Rename Recovered Board' }))
    fireEvent.change(
      screen.getByRole('textbox', { name: 'New name for Recovered Board' }),
      { target: { value: 'Bench PSU' } },
    )
    fireEvent.blur(screen.getByRole('textbox', { name: 'New name for Recovered Board' }))

    await waitFor(() => expect(screen.getByText('Bench PSU')).toBeInTheDocument())
    expect(updateMock).toHaveBeenCalledWith({ name: 'Bench PSU', updated_at: expect.any(String) })
    expect(eqMock).toHaveBeenCalledWith('id', 'cloud-1')
    expect(onProjectRenamed).toHaveBeenCalledWith(expect.objectContaining({ id: 'cloud-1', name: 'Bench PSU' }))
  })

  it('keeps the stored name and says why when the write is rejected', async () => {
    const iso = new Date().toISOString()
    const row = { id: 'cloud-1', user_id: 'user-1', name: 'Recovered Board', description: '', created_at: iso, updated_at: iso }
    fromMock.mockImplementation(() => ({
      select: () => ({ order: () => Promise.resolve({ data: [row], error: null }) }),
      update: () => ({
        eq: () => Promise.resolve({ data: null, error: new Error('row-level security blocked the write') }),
      }),
    }))
    const { onProjectRenamed } = renderManager({ offlineMode: false })

    fireEvent.click(await screen.findByRole('button', { name: 'Rename Recovered Board' }))
    fireEvent.change(
      screen.getByRole('textbox', { name: 'New name for Recovered Board' }),
      { target: { value: 'Bench PSU' } },
    )
    fireEvent.blur(screen.getByRole('textbox', { name: 'New name for Recovered Board' }))

    // The card goes back to the name the workspace really holds, with the reason
    // under it. A field that vanished without either would read as a saved rename.
    expect(await screen.findByText(/Could not rename the project/)).toHaveTextContent('row-level security blocked the write')
    expect(screen.getByText('Recovered Board')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'New name for Recovered Board' })).not.toBeInTheDocument()
    expect(onProjectRenamed).not.toHaveBeenCalled()
  })
})
