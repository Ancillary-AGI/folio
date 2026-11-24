import { NextResponse } from 'next/server'
import { runnerEnabled } from '../../../../../src/lib/agents/server/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Capability probe. It reveals whether the runner is switched on, not whether
 * a credential works and nothing about any job: a client uses it to explain
 * "the deployment has no cloud runner" before attempting a submission.
 */
export function GET() {
  return NextResponse.json({
    schema: 'folio.agent-runner/1',
    enabled: runnerEnabled(),
    protocol: '/v1/agent/jobs',
  })
}
