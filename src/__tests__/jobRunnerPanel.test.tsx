/**
 * JobRunnerPanel — the Always-on queue surface.
 * The panel renders whatever the runner reports: jobs, steps, approvals and
 * recovery flags. Fake executors keep these tests fast and deterministic.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import JobRunnerPanel from '../components/ecad/agent/JobRunnerPanel'
import { createAgentJobRunner, type JobExecutor } from '../lib/agents/jobRunner'
import { agentJobStore, createAgentJob } from '../lib/agents/jobQueue'

/** Two instant steps; every job completes as soon as it runs. */
const instantExecutor = (): JobExecutor => async (job, _control, hooks) => {
  job.phase = 'act'
  job.steps = [
    { tool: 'cad.observe', rationale: 'look at the sheet', args: {}, status: 'succeeded', needsApproval: false },
    { tool: 'cad.erc', rationale: 'check the nets', args: {}, status: 'succeeded', needsApproval: false },
  ]
  hooks.update(job)
  job.phase = 'report'
  hooks.update(job)
  return { status: 'completed', report: 'Sheet observed; ERC clean.' }
}

/** Pauses without an approval on the first run; finishes on the second. */
const suspendingExecutor = (): JobExecutor => async (job, _control, hooks) => {
  job.phase = 'act'
  if (job.steps.length === 0) {
    job.steps = [
      { tool: 'cad.observe', rationale: 'look at the sheet', args: {}, status: 'pending', needsApproval: false },
    ]
    hooks.update(job)
    return { status: 'paused', report: 'Suspended for the human.' }
  }
  job.steps[0].status = 'succeeded'
  job.phase = 'report'
  hooks.update(job)
  return { status: 'completed', report: 'Finished after resume.' }
}

/** Pauses for an approval on the first run; honours the granted decision. */
const approvalExecutor = (): JobExecutor => async (job, _control, hooks) => {
  job.phase = 'act'
  job.steps = [
    { tool: 'eda.exportFab', rationale: 'ship the board', args: { project: 'current' }, status: 'pending', needsApproval: true },
  ]
  if (!job.grantedApprovals?.includes(0)) {
    if (job.deniedApprovals?.includes(0)) {
      job.steps[0].status = 'denied'
      hooks.update(job)
      return { status: 'stopped', report: 'Step denied; job stopped.' }
    }
    hooks.update(job)
    return {
      status: 'paused',
      report: 'Needs approval.',
      pendingApproval: { stepIndex: 0, tool: 'eda.exportFab', args: { project: 'current' } },
    }
  }
  job.steps[0].status = 'succeeded'
  job.phase = 'report'
  hooks.update(job)
  return { status: 'completed', report: 'Export approved and shipped.' }
}

const makeRunner = (executor: JobExecutor) => createAgentJobRunner({
  executor,
  yieldUi: () => Promise.resolve(),
})

beforeEach(() => {
  localStorage.clear()
})

describe('JobRunnerPanel queueing', () => {
  it('renders the empty state and queues a template job to completion', async () => {
    const runner = makeRunner(instantExecutor())
    render(<JobRunnerPanel runner={runner} />)
    expect(screen.getByText('No jobs yet.', { exact: false })).toBeInTheDocument()

    runner.start()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect schematic' }))
    await runner.waitUntilIdle()

    // A freshly queued job auto-expands, so the report is visible right away.
    expect(await screen.findByText('completed')).toBeInTheDocument()
    expect(screen.getByText('Sheet observed; ERC clean.')).toBeInTheDocument()
    expect(screen.getByText(/2\/2 step\(s\)/)).toBeInTheDocument()
  })

  it('queues from the prompt input and clears it', async () => {
    const runner = makeRunner(instantExecutor())
    render(<JobRunnerPanel runner={runner} />)
    runner.start()
    const prompt = 'Audit every net on this sheet and report anything that would fail ERC.'

    fireEvent.change(screen.getByTestId('job-prompt-input'), { target: { value: prompt } })
    expect(screen.getByTestId('job-add-button')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('job-add-button'))

    expect(screen.getByTestId('job-prompt-input')).toHaveValue('')
    expect(screen.getByText(prompt)).toBeInTheDocument()
    expect(await screen.findByText('completed')).toBeInTheDocument()
  })

  it('ignores an empty prompt', async () => {
    const runner = makeRunner(instantExecutor())
    render(<JobRunnerPanel runner={runner} />)
    expect(screen.getByTestId('job-add-button')).toBeDisabled()
    expect(runner.list()).toHaveLength(0)
  })
})

describe('JobRunnerPanel controls', () => {
  it('shows Resume for a paused job and resumes it', async () => {
    const runner = makeRunner(suspendingExecutor())
    render(<JobRunnerPanel runner={runner} />)
    runner.start()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect schematic' }))
    await runner.waitUntilIdle()

    expect(await screen.findByText('paused')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pause job/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Resume job/ }))
    await runner.waitUntilIdle()

    expect(await screen.findByText('completed')).toBeInTheDocument()
  })

  it('shows the approval banner and honours Approve', async () => {
    const runner = makeRunner(approvalExecutor())
    render(<JobRunnerPanel runner={runner} />)
    runner.start()
    const job = runner.enqueue({ prompt: 'Export for fab' })!
    await runner.waitUntilIdle()

    expect(await screen.findByText('Approval required')).toBeInTheDocument()
    expect(screen.getByText(/eda\.exportFab/)).toBeInTheDocument()
    // A paused approval has no Resume path around it.
    expect(screen.queryByRole('button', { name: /Resume job/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Approve step 1 of Export for fab' }))
    await runner.waitUntilIdle()

    expect(await screen.findByText('completed')).toBeInTheDocument()
    expect(runner.get(job.id)?.status).toBe('completed')
    fireEvent.click(screen.getByRole('button', { name: /Expand job/ }))
    expect(await screen.findByText('Export approved and shipped.')).toBeInTheDocument()
  })

  it('shows Deny and stops the job when denied', async () => {
    const runner = makeRunner(approvalExecutor())
    render(<JobRunnerPanel runner={runner} />)
    runner.start()
    const job = runner.enqueue({ prompt: 'Export for fab' })!
    await runner.waitUntilIdle()
    await screen.findByText('Approval required')

    fireEvent.click(screen.getByRole('button', { name: 'Deny step 1 of Export for fab' }))
    await runner.waitUntilIdle()

    expect(runner.get(job.id)?.status).toBe('stopped')
    expect(await screen.findByText('stopped')).toBeInTheDocument()
  })

  it('removes a finished job', async () => {
    const runner = makeRunner(instantExecutor())
    render(<JobRunnerPanel runner={runner} />)
    runner.start()
    runner.enqueue({ prompt: 'Check my nets' })
    await runner.waitUntilIdle()
    await screen.findByText('completed')

    fireEvent.click(screen.getByRole('button', { name: 'Remove job Check my nets' }))
    await waitFor(() => expect(screen.queryByText('Check my nets')).not.toBeInTheDocument())
    expect(screen.getByText('No jobs yet.', { exact: false })).toBeInTheDocument()
  })
})

describe('JobRunnerPanel recovery', () => {
  it('flags a job recovered after the app closed', async () => {
    agentJobStore.save({
      ...createAgentJob({ prompt: 'Run the queued inspection', title: 'Recovered inspection' }),
      status: 'paused',
      phase: 'act',
      recoveredFromCrash: true,
      steps: [
        { tool: 'cad.observe', rationale: 'look', args: {}, status: 'succeeded', needsApproval: false },
      ],
    })
    const runner = makeRunner(instantExecutor())
    render(<JobRunnerPanel runner={runner} />)

    expect(screen.getByText('Recovered inspection')).toBeInTheDocument()
    expect(screen.getByText(/Recovered after the app closed/)).toBeInTheDocument()
    expect(await screen.findByText('paused')).toBeInTheDocument()
  })
})
