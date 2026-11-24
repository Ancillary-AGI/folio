import { NextRequest, NextResponse } from 'next/server'
import { authorizeRunner, mayAccessJob } from '../../../../../../src/lib/agents/server/auth'
import { getCloudAgentRunner } from '../../../../../../src/lib/agents/server/singleton'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: { jobId: string } }) {
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
    // A token holder must not learn whether another owner's job exists.
    return NextResponse.json({ error: 'not_found', message: 'No such job.' }, { status: 404 })
  }
  const status = runner.status(jobId)
  if (!status) return NextResponse.json({ error: 'not_found', message: 'No such job.' }, { status: 404 })
  return NextResponse.json(status)
}
