/**
 * Splitting a server-sent-events body into JSON payloads.
 *
 * All three protocols stream the same framing (`data: {json}\n\n`), so one
 * parser serves them; only the payload shapes differ, and `protocol.ts` owns
 * those. A final unterminated event is flushed rather than dropped — a model
 * that closes the socket mid-answer should still deliver the last chunk.
 */

export interface SseEvent {
  /** The `event:` name when the server sends one (Anthropic always does). */
  name?: string
  data: string
}

export function parseSseBlock(block: string): SseEvent | null {
  let data = ''
  let name: string | undefined
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '')
    else if (line.startsWith('event:')) name = line.slice(6).trim()
  }
  if (!data && !name) return null
  return { name, data }
}

/**
 * Yields each event as it becomes available. `reader` is any WHATWG stream
 * reader so a test can hand over an in-memory one.
 */
export async function* readSse(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    // Some gateways frame events with CRLF; normalising here means one boundary
    // rule instead of a parser that silently waits for bytes that never come.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let boundary = buffer.search(/\n\n/)
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const event = parseSseBlock(block)
      if (event) yield event
      boundary = buffer.search(/\n\n/)
    }
  }
  const tail = parseSseBlock(buffer)
  if (tail) yield tail
}
