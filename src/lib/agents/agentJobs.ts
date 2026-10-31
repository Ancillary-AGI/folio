/**
 * The app's single always-on agent job runner.
 *
 * Mounted once by the shell (`agentJobRunner.start()`), it owns the persisted
 * queue and the live executor. Panels subscribe to it; jobs keep running while
 * the user works in any workspace, pause on tab close, and resume from their
 * first unfinished step on the next visit.
 */
import { createAgentJobRunner } from './jobRunner'
import { createAgentJobExecutor } from './jobExecutor'

export const agentJobRunner = createAgentJobRunner({
  executor: createAgentJobExecutor(),
})
