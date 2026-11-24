import { NextRequest, NextResponse } from 'next/server'
import { authorizeRunner, mayAccessJob } from '../../../../../../../src/lib/agents/server/auth'
import { getCloudAgentRunner } from '../../../../../../../src/lib/agents/server/singleton'
import { isTerminalCloudJobState } from '../../../../../../../src/lib/agents/server/cloudRunner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
    return NextResponse.json({ error: 'not_found', message: 'No such job.' }, { status: 404 })
  }
  if (!runner.status(jobId)) {
    return NextResponse.json({ error: 'not_found', message: 'No such job.' }, { status: 404 })
  }

  const parseCursor = (value: string | null): number => {
    const parsed = Number(value ?? '0')
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  }
  let after = Math.max(
    parseCursor(new URL(request.url).searchParams.get('after')),
    parseCursor(request.headers.get('last-event-id')),
  )

  const wantsStream = request.headers.get('accept')?.includes('text/event-stream') ?? false
  if (!wantsStream) {
    return NextResponse.json({ events: runner.events(jobId, after) })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (chunk: string): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }
      const finish = (): void => {
        if (closed) return
        send('data: [DONE]\n\n')
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed by the client */
        }
      }
      const onAbort = (): void => finish()
      request.signal.addEventListener('abort', onAbort)
      try {
        for (;;) {
          if (request.signal.aborted) return finish()
          for (const event of runner.events(jobId, after)) {
            send(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)
            after = Math.max(after, event.seq)
          }
          const status = runner.status(jobId)
          if (!status) return finish()
          if (isTerminalCloudJobState(status.state)) return finish()
          await sleep(500)
        }
      } catch {
        finish()
      } finally {
        request.signal.removeEventListener('abort', onAbort)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
