import { NextRequest, NextResponse } from 'next/server'
import { authorizeRunner, mayAccessJob } from '../../../../../../../src/lib/agents/server/auth'
import { getCloudAgentRunner } from '../../../../../../../src/lib/agents/server/singleton'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: { params: { jobId: string } }) {
  const identity = authorizeRunner(request.headers)
  if (!identity.ok) {
    return NextResponse.json({ error: identity.error, message: identity.message }, { status: identity.status })
  }
  let runner: Awaited<ReturnType<typeof getCloudAgentRunner>>
  try {
    runner = await getCloudAgentRunner()
  } catch (error) {
    return NextResponse.json(
      { error: 'runner_unavailable', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
  const jobId = context.params.jobId
  if (!mayAccessJob(identity, runner.ownerOf(jobId))) {
    return NextResponse.json({ error: 'not_found', message: 'No such job.' }, { status: 404 })
  }
  const cancelled = await runner.cancel(jobId)
  if (!cancelled) {
    const status = runner.status(jobId)
    if (!status) return NextResponse.json({ error: 'not_found', message: 'No such job.' }, { status: 404 })
    return NextResponse.json(
      { jobId, state: status.state, message: 'The job is already terminal; cancellation does not rewrite history.' },
      { status: 409 },
    )
  }
  return NextResponse.json({ jobId, state: runner.status(jobId)?.state ?? 'cancelled' })
}
