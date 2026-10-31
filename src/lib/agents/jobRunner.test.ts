import { beforeEach, describe, expect, it } from 'vitest'
import { createAgentJobRunner, type JobExecutor } from './jobRunner'
import { agentJobStore, createAgentJob } from './jobQueue'

/** An executor that runs three steps, honouring cooperative pause/cancel. */
const steppedExecutor = (): JobExecutor => async (job, control, hooks) => {
  job.phase = 'act'
  for (let index = 0; index < 3; index++) {
    if (control.paused()) {
      return { status: 'paused', report: `Paused at step ${index + 1}.` }
    }
    if (control.aborted()) {
      return { status: 'stopped', report: 'Stopped.' }
    }
    job.steps[index] = {
      tool: `step-${index}`,
      rationale: 'test',
      args: {},
      status: 'succeeded',
      needsApproval: false,
    }
    hooks.update(job)
    await hooks.yieldUi()
  }
  job.phase = 'report'
  hooks.update(job)
  return { status: 'completed', report: 'All steps done.' }
}

const instantRunner = () => createAgentJobRunner({
  executor: steppedExecutor(),
  now: () => Date.now(),
  yieldUi: () => Promise.resolve(),
})

beforeEach(() => {
  localStorage.clear()
})

describe('queue processing', () => {
  it('runs jobs FIFO to completion', async () => {
    const runner = instantRunner()
    const first = runner.enqueue({ prompt: 'first job' })
    const second = runner.enqueue({ prompt: 'second job' })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    runner.start()
    await runner.waitUntilIdle()
    expect(runner.get(first!.id)?.status).toBe('completed')
    expect(runner.get(second!.id)?.status).toBe('completed')
    expect(runner.get(first!.id)?.steps).toHaveLength(3)
    expect(runner.get(first!.id)?.finishedAt).toBeDefined()
  })

  it('does not run until started', async () => {
    const runner = instantRunner()
    const job = runner.enqueue({ prompt: 'waiting' })
    await Promise.resolve()
    expect(runner.get(job!.id)?.status).toBe('queued')
  })

  it('rejects an empty prompt', () => {
    const runner = instantRunner()
    expect(runner.enqueue({ prompt: '   ' })).toBeNull()
  })
})

describe('pause and resume', () => {
  it('pauses a running job at the next step and resumes from where it stopped', async () => {
    const runner = instantRunner()
    const job = runner.enqueue({ prompt: 'long job' })!
    runner.start()
    // The executor suspends after its first step; pause before it continues.
    runner.pause(job.id)
    await runner.waitUntilIdle()
    const paused = runner.get(job.id)
    expect(paused?.status).toBe('paused')
    expect(paused?.report).toContain('Paused at step 2')

    expect(runner.resume(job.id)).toBe(true)
    await runner.waitUntilIdle()
    const finished = runner.get(job.id)
    expect(finished?.status).toBe('completed')
    expect(finished?.steps).toHaveLength(3)
  })

  it('holds a queued job when paused and releases it on resume', async () => {
    const runner = instantRunner()
    const job = runner.enqueue({ prompt: 'hold me' })!
    expect(runner.pause(job.id)).toBe(true)
    await Promise.resolve()
    expect(runner.get(job.id)?.status).toBe('paused')
    runner.start()
    await runner.waitUntilIdle()
    expect(runner.get(job.id)?.status).toBe('paused')

    expect(runner.resume(job.id)).toBe(true)
    await runner.waitUntilIdle()
    expect(runner.get(job.id)?.status).toBe('completed')
  })

  it('does not let resume bypass a pending approval', async () => {
    const runner = createAgentJobRunner({
      executor: async (job, _control, hooks) => {
        job.phase = 'act'
        job.steps = [
          { tool: 'eda.exportFab', rationale: 'fab', args: {}, status: 'pending', needsApproval: true },
        ]
        hooks.update(job)
        return {
          status: 'paused',
          report: 'Needs approval.',
          pendingApproval: { stepIndex: 0, tool: 'eda.exportFab', args: {} },
        }
      },
      yieldUi: () => Promise.resolve(),
    })
    const job = runner.enqueue({ prompt: 'approval job' })!
    runner.start()
    await runner.waitUntilIdle()
    expect(runner.get(job.id)?.status).toBe('paused')
    expect(runner.get(job.id)?.pendingApproval).toBeDefined()
    // Resuming around the unanswered approval is refused; the decision path
    // is the only way through.
    expect(runner.resume(job.id)).toBe(false)
    expect(runner.decideApproval(job.id, true)).toBe(true)
  })
})

describe('cancellation', () => {
  it('stops a running job cooperatively', async () => {
    const runner = instantRunner()
    const job = runner.enqueue({ prompt: 'cancel me' })!
    runner.start()
    runner.cancel(job.id)
    await runner.waitUntilIdle()
    expect(runner.get(job.id)?.status).toBe('stopped')
    expect(runner.get(job.id)?.report).toBe('Stopped.')
  })

  it('stops a queued job before it runs', async () => {
    const runner = instantRunner()
    const job = runner.enqueue({ prompt: 'never run' })!
    expect(runner.cancel(job.id)).toBe(true)
    expect(runner.get(job.id)?.status).toBe('stopped')
    expect(runner.get(job.id)?.report).toBe('Stopped before it could run.')
  })

  it('refuses to cancel finished work', async () => {
    const runner = instantRunner()
    const job = runner.enqueue({ prompt: 'done' })!
    runner.start()
    await runner.waitUntilIdle()
    expect(runner.get(job.id)?.status).toBe('completed')
    expect(runner.cancel(job.id)).toBe(false)
  })
})

describe('approval flow', () => {
  const approvalExecutor = (): JobExecutor => async (job, _control, hooks) => {
    job.phase = 'act'
    if (job.steps.length === 0) {
      job.steps = [
        { tool: 'eda.exportFab', rationale: 'fab', args: {}, status: 'pending', needsApproval: true },
      ]
      hooks.update(job)
    }
    if (job.deniedApprovals?.includes(0)) {
      return { status: 'stopped', report: 'Denied by the human.' }
    }
    if (!job.grantedApprovals?.includes(0)) {
      return {
        status: 'paused',
        report: 'Needs approval.',
        pendingApproval: { stepIndex: 0, tool: 'eda.exportFab', args: {} },
      }
    }
    job.steps[0] = { ...job.steps[0], status: 'succeeded' }
    hooks.update(job)
    return { status: 'completed', report: 'Fab done.' }
  }

  const approvalRunner = () => createAgentJobRunner({
    executor: approvalExecutor(),
    yieldUi: () => Promise.resolve(),
  })

  it('pauses for approval and completes when approved', async () => {
    const runner = approvalRunner()
    const job = runner.enqueue({ prompt: 'export for fab' })!
    runner.start()
    await runner.waitUntilIdle()
    const paused = runner.get(job.id)
    expect(paused?.status).toBe('paused')
    expect(paused?.pendingApproval?.tool).toBe('eda.exportFab')
    expect(paused?.report).toContain('Needs approval')

    expect(runner.decideApproval(job.id, true)).toBe(true)
    await runner.waitUntilIdle()
    const finished = runner.get(job.id)
    expect(finished?.status).toBe('completed')
    expect(finished?.grantedApprovals).toEqual([0])
    expect(finished?.pendingApproval).toBeUndefined()
  })

  it('stops the job when approval is denied', async () => {
    const runner = approvalRunner()
    const job = runner.enqueue({ prompt: 'export for fab' })!
    runner.start()
    await runner.waitUntilIdle()
    expect(runner.decideApproval(job.id, false)).toBe(true)
    await runner.waitUntilIdle()
    expect(runner.get(job.id)?.status).toBe('stopped')
  })

  it('refuses a decision when nothing is awaiting approval', () => {
    const runner = approvalRunner()
    const job = runner.enqueue({ prompt: 'export for fab' })!
    expect(runner.decideApproval(job.id, true)).toBe(false)
  })
})

describe('crash recovery', () => {
  it('recovers a persisted running job as paused with the honest flag', () => {
    const running = createAgentJob({ prompt: 'interrupted' })
    running.status = 'running'
    agentJobStore.save(running)

    const runner = instantRunner()
    expect(runner.recover()).toBe(1)
    expect(runner.get(running.id)?.status).toBe('paused')
    expect(runner.get(running.id)?.recoveredFromCrash).toBe(true)
  })
})

describe('removal and subscriptions', () => {
  it('removes finished jobs but refuses running ones', async () => {
    const runner = instantRunner()
    const done = runner.enqueue({ prompt: 'done job' })!
    runner.start()
    await runner.waitUntilIdle()
    expect(runner.remove(done.id)).toBe(true)
    expect(runner.get(done.id)).toBeUndefined()

    const running = runner.enqueue({ prompt: 'busy job' })!
    expect(runner.remove(running.id)).toBe(false)
    await runner.waitUntilIdle()
    expect(runner.remove(running.id)).toBe(true)
  })

  it('notifies subscribers on enqueue', () => {
    const runner = instantRunner()
    let notifications = 0
    runner.subscribe(() => { notifications += 1 })
    runner.enqueue({ prompt: 'notify me' })
    expect(notifications).toBe(1)
  })
})

describe('failed executors', () => {
  it('records a thrown executor as a failed job with the real message', async () => {
    const runner = createAgentJobRunner({
      executor: async () => {
        throw new Error('executor exploded')
      },
      yieldUi: () => Promise.resolve(),
    })
    const job = runner.enqueue({ prompt: 'boom' })!
    runner.start()
    await runner.waitUntilIdle()
    const failed = runner.get(job.id)
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toBe('executor exploded')
  })
})
