import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TutorialRunner from '../components/help/TutorialRunner'
import { TUTORIALS, readTutorialProgress, writeTutorialProgress } from '../lib/tutorials/tutorials'
import { useAppStore } from '../stores/useAppStore'

const tutorial = TUTORIALS[0]

function renderRunner(overrides: Partial<Parameters<typeof TutorialRunner>[0]> = {}) {
  const props = {
    tutorial,
    onClose: vi.fn(),
    onRestartDemo: vi.fn(),
    onOpenHelp: vi.fn(),
    ...overrides,
  }
  render(<TutorialRunner {...props} />)
  return props
}

describe('tutorial runner', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAppStore.getState().setWorkspaceMode('schematic')
  })

  it('opens the workspace for each step and records the step', () => {
    renderRunner()
    expect(screen.getByText(tutorial.steps[0].title)).toBeInTheDocument()
    expect(useAppStore.getState().workspaceMode).toBe(tutorial.steps[0].mode)

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(tutorial.steps[1].title)).toBeInTheDocument()
    expect(useAppStore.getState().workspaceMode).toBe(tutorial.steps[1].mode)
    expect(readTutorialProgress(tutorial.id)?.step).toBe(1)
  })

  it('resumes at the saved step when progress exists', () => {
    writeTutorialProgress(tutorial.id, { step: 2, completed: false, updatedAt: '' })
    renderRunner()
    expect(screen.getByText(tutorial.steps[2].title)).toBeInTheDocument()
    expect(screen.getByText(`3 / ${tutorial.steps.length}`)).toBeInTheDocument()
  })

  it('finishes on the last step and records completion', () => {
    renderRunner()
    for (let step = 1; step < tutorial.steps.length; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    }
    fireEvent.click(screen.getByRole('button', { name: /finish/i }))

    expect(screen.getByText('Tutorial complete')).toBeInTheDocument()
    expect(screen.getByText(/Nothing here was graded/)).toBeInTheDocument()
    expect(readTutorialProgress(tutorial.id)?.completed).toBe(true)
  })

  it('restarts the demo and returns to the first step', () => {
    const props = renderRunner()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /restart demo/i }))

    expect(props.onRestartDemo).toHaveBeenCalledTimes(1)
    expect(screen.getByText(tutorial.steps[0].title)).toBeInTheDocument()
    expect(useAppStore.getState().workspaceMode).toBe(tutorial.steps[0].mode)
  })

  it('collapses so the sheet stays visible, and closes on request', () => {
    const props = renderRunner()
    fireEvent.click(screen.getByRole('button', { name: /collapse tutorial/i }))
    expect(screen.queryByText(tutorial.steps[0].title)).toBeNull()
    expect(screen.getByRole('button', { name: /expand tutorial/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /close tutorial/i }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('states that the steps are self-checked', () => {
    renderRunner()
    expect(screen.getByText(/Steps are self-checked/)).toBeInTheDocument()
  })
})
