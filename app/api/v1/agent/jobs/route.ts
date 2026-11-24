import { NextRequest, NextResponse } from 'next/server'
import { authorizeRunner } from '../../../../../src/lib/agents/server/auth'
import { parseCloudJobRequest } from '../../../../../src/lib/agents/server/cloudRunner'
import { getCloudAgentRunner } from '../../../../../src/lib/agents/server/singleton'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 12 MB is enough for a board with thousands of parts and still bounded. */
const MAX_BODY_BYTES = 12 * 1024 * 1024

export async function POST(request: NextRequest) {
  const identity = authorizeRunner(request.headers)
  if (!identity.ok) {
    return NextResponse.json({ error: identity.error, message: identity.message }, { status: identity.status })
  }

  let body: unknown
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large', message: `A job body is capped at ${MAX_BODY_BYTES} bytes.` },
      { status: 413 },
    )
  }
  try {
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: 'payload_too_large', message: `A job body is capped at ${MAX_BODY_BYTES} bytes.` },
        { status: 413 },
      )
    }
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid_json', message: 'The request body is not valid JSON.' }, { status: 400 })
  }

  const parsed = parseCloudJobRequest(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'invalid_job', message: parsed.error }, { status: 400 })
  }
  if (parsed.request.approvalMode === 'on-write') {
    return NextResponse.json(
      {
        error: 'approval_not_supported',
        message:
          'The built-in runner has no human approval channel. Submit with approvalMode "auto", ' +
          'or point this client at an external runner that implements approval gates.',
      },
      { status: 422 },
    )
  }

  try {
    const runner = await getCloudAgentRunner()
    const { job, created } = await runner.submit(parsed.request, identity.mode === 'token' ? identity.ownerId : undefined)
    return NextResponse.json({ jobId: job.id, state: job.state }, { status: created ? 201 : 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'runner_unavailable', message }, { status: 500 })
  }
}

export function GET() {
  return NextResponse.json(
    { error: 'method_not_allowed', message: 'Submit jobs with POST; poll a job at /v1/agent/jobs/{jobId}.' },
    { status: 405 },
  )
}
