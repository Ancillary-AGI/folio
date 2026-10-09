/**
 * Browser upload session (Giant 3).
 *
 * The audit verdict was "honest but dead": `uploadSketch()` returns 'No
 * upload transport in the browser' because Folio is a pure SPA and the
 * arduino-cli/avrdude paths only run under Node. The Intel-HEX codec and
 * the WebSerial bridge already exist and are solid — this module joins
 * them: STK500v1 over WebSerial with read-back verification.
 *
 * Protocol (Arduino bootloader / Optiboot STK500v1):
 *   GET_SYNC (0x30, EOP 0x20) → INSYNC (0x14) + OK (0x10)
 *   LOAD_ADDRESS (0x55, low, high, EOP) → INSYNC + OK
 *   PROG_PAGE (0x64, len-hi, len-lo, 'F', data…, EOP) → INSYNC + OK
 *   READ_PAGE (0x74, len-hi, len-lo, 'F', EOP) → INSYNC + data… + OK
 *
 * Fail-loud throughout: every reply is framed and checked, every written
 * page is read back and byte-compared before the session reports success,
 * and the absence of WebSerial is a typed refusal — never a fake upload.
 * The session talks to a minimal byte transport interface so tests drive
 * it with a scripted fake instead of hardware.
 */
import { parseIntelHex } from '../compilation/intelHex'

export const STK_INSYNC = 0x14
export const STK_OK = 0x10
const STK_EOP = 0x20
const CMD_GET_SYNC = 0x30
const CMD_LOAD_ADDRESS = 0x55
const CMD_PROG_PAGE = 0x64
const CMD_READ_PAGE = 0x74
const MEM_FLASH = 0x46 // 'F'

/** Minimal byte transport: WebSerialBridge satisfies this structurally. */
export interface ByteTransport {
  write(data: Uint8Array): Promise<void>
  onData(callback: (data: Uint8Array) => void): void
}

export interface UploadProgress {
  /** 0..1 fraction of pages programmed. */
  fraction: number
  pagesDone: number
  pagesTotal: number
}

export interface UploadSessionResult {
  success: boolean
  /** Human-readable outcome, including the failure reason. */
  message: string
  bytesWritten: number
  bytesVerified: number
  pagesTotal: number
}

export interface UploadSessionOptions {
  /** Flash page size in bytes (Uno/Optiboot: 128). */
  pageSize?: number
  /** Device flash capacity; images beyond it are refused, not truncated. */
  flashSize?: number
  /** Per-command reply timeout, ms. */
  timeoutMs?: number
  onProgress?: (progress: UploadProgress) => void
}

const DEFAULT_PAGE_SIZE = 128
const DEFAULT_TIMEOUT_MS = 1500

/** Split the image into page-aligned flash pages, padding with 0xFF. */
function splitPages(bytes: Uint8Array, baseAddress: number, pageSize: number): Array<{ address: number; data: Uint8Array }> {
  const pages: Array<{ address: number; data: Uint8Array }> = []
  const startPage = Math.floor(baseAddress / pageSize)
  const endAddress = baseAddress + bytes.length
  for (let page = startPage; page * pageSize < endAddress; page += 1) {
    const pageStart = page * pageSize
    const pageData = new Uint8Array(pageSize).fill(0xff)
    for (let i = 0; i < pageSize; i += 1) {
      const absolute = pageStart + i
      if (absolute >= baseAddress && absolute < endAddress) pageData[i] = bytes[absolute - baseAddress]
    }
    pages.push({ address: pageStart, data: pageData })
  }
  return pages
}

/** One framed command exchange: write bytes, collect a reply, enforce framing. */
async function exchange(
  transport: ByteTransport,
  command: Uint8Array,
  readLength: number,
  timeoutMs: number,
  label: string,
): Promise<Uint8Array> {
  const received: number[] = []
  let resolveWait: (() => void) | undefined
  const notify = (): void => {
    resolveWait?.()
    resolveWait = undefined
  }
  transport.onData((chunk) => {
    received.push(...chunk)
    notify()
  })
  await transport.write(command)
  const deadline = Date.now() + timeoutMs
  while (received.length < readLength) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`${label}: reply timed out after ${timeoutMs} ms.`)
    await new Promise<void>((resolve) => {
      resolveWait = resolve
      setTimeout(resolve, Math.min(remaining, 25))
    })
  }
  const reply = Uint8Array.from(received.slice(0, readLength))
  if (reply[0] !== STK_INSYNC) throw new Error(`${label}: expected INSYNC (0x14), got 0x${(reply[0] ?? 0).toString(16)}.`)
  if (reply[reply.length - 1] !== STK_OK) throw new Error(`${label}: expected OK (0x10), got 0x${(reply[reply.length - 1] ?? 0).toString(16)}.`)
  return reply
}

const wordAddress = (byteAddress: number): [number, number] => [(byteAddress >> 1) & 0xff, (byteAddress >> 9) & 0xff]

/**
 * Upload an Intel-HEX image over an STK500v1 transport with read-back
 * verification. Returns success only when every page read back
 * byte-identical. Throws nothing — all failures are typed results.
 */
export async function uploadHexImage(
  transport: ByteTransport,
  hexText: string,
  options: UploadSessionOptions = {},
): Promise<UploadSessionResult> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fail = (message: string, partial?: Partial<UploadSessionResult>): UploadSessionResult => ({
    success: false,
    message,
    bytesWritten: 0,
    bytesVerified: 0,
    pagesTotal: 0,
    ...partial,
  })
  const parsed = parseIntelHex(hexText)
  if ('error' in parsed) return fail(`Refusing image: Intel HEX error at line ${parsed.line}: ${parsed.error}.`)
  if (parsed.bytes.length === 0) return fail('Refusing image: no data records.')
  if (options.flashSize !== undefined && parsed.baseAddress + parsed.bytes.length > options.flashSize) {
    return fail(`Refusing image: ${parsed.bytes.length} bytes at 0x${parsed.baseAddress.toString(16)} exceed flash ${options.flashSize}.`)
  }
  const pages = splitPages(parsed.bytes, parsed.baseAddress, pageSize)
  try {
    await exchange(transport, Uint8Array.from([CMD_GET_SYNC, STK_EOP]), 2, timeoutMs, 'GET_SYNC')
  } catch (error) {
    return fail(`No bootloader sync: ${error instanceof Error ? error.message : 'unknown error'}.`)
  }
  let bytesWritten = 0
  try {
    for (const [index, page] of pages.entries()) {
      const [low, high] = wordAddress(page.address)
      await exchange(transport, Uint8Array.from([CMD_LOAD_ADDRESS, low, high, STK_EOP]), 2, timeoutMs, `LOAD_ADDRESS 0x${page.address.toString(16)}`)
      const program = new Uint8Array(4 + pageSize + 1)
      program[0] = CMD_PROG_PAGE
      program[1] = (pageSize >> 8) & 0xff
      program[2] = pageSize & 0xff
      program[3] = MEM_FLASH
      program.set(page.data, 4)
      program[4 + pageSize] = STK_EOP
      await exchange(transport, program, 2, timeoutMs, `PROG_PAGE 0x${page.address.toString(16)}`)
      bytesWritten += pageSize
      options.onProgress?.({ fraction: (index + 1) / pages.length, pagesDone: index + 1, pagesTotal: pages.length })
    }
  } catch (error) {
    return fail(`Programming failed: ${error instanceof Error ? error.message : 'unknown error'}.`, { bytesWritten, pagesTotal: pages.length })
  }
  // Read-back verification: every page, byte-compared.
  let bytesVerified = 0
  try {
    for (const page of pages) {
      const [low, high] = wordAddress(page.address)
      await exchange(transport, Uint8Array.from([CMD_LOAD_ADDRESS, low, high, STK_EOP]), 2, timeoutMs, `VERIFY LOAD_ADDRESS 0x${page.address.toString(16)}`)
      const read = new Uint8Array([CMD_READ_PAGE, (pageSize >> 8) & 0xff, pageSize & 0xff, MEM_FLASH, STK_EOP])
      const reply = await exchange(transport, read, 2 + pageSize, timeoutMs, `READ_PAGE 0x${page.address.toString(16)}`)
      const echoed = reply.slice(1, 1 + pageSize)
      for (let i = 0; i < pageSize; i += 1) {
        if (echoed[i] !== page.data[i]) {
          return fail(`Verification mismatch at 0x${(page.address + i).toString(16)}: wrote 0x${(page.data[i] ?? 0).toString(16)}, read 0x${(echoed[i] ?? 0).toString(16)}.`, { bytesWritten, pagesTotal: pages.length, bytesVerified })
        }
      }
      bytesVerified += pageSize
    }
  } catch (error) {
    return fail(`Verification failed: ${error instanceof Error ? error.message : 'unknown error'}.`, { bytesWritten, pagesTotal: pages.length, bytesVerified })
  }
  return { success: true, message: `Uploaded and verified ${bytesVerified} bytes in ${pages.length} pages.`, bytesWritten, bytesVerified, pagesTotal: pages.length }
}

