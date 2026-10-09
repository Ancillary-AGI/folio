import { describe, expect, it } from 'vitest'
import {
  ArduinoIDEIntegration,
  arduinoIdeCandidates,
  boardProgrammer,
  launchDetached,
  openWithDefaultApplication,
} from './boardProgrammer'

/*
 * The suite runs under jsdom — the same `window`-defined world as a browser
 * build — so these tests prove every Node-only entry point fails closed *before*
 * touching Vite's stubbed `child_process`/`fs`/`process`. A missed guard here
 * would throw at runtime for real users; a guard that merely catches the
 * rejection would be indistinguishable from "tool not installed", which is why
 * each helper must return its sentinel value instead of throwing.
 */
describe('browser fail-closed guards', () => {
  it('never spawns or opens anything from the browser', async () => {
    expect(await launchDetached('definitely-not-a-real-command', [])).toBe(false)
    expect(await openWithDefaultApplication('sketch.ino')).toBe(false)
  })

  it('offers no Arduino IDE candidates without a Node environment', () => {
    expect(arduinoIdeCandidates()).toEqual([])
  })

  it('reports ports, IDE, board cores and FPGA tooling as unavailable', async () => {
    expect(await boardProgrammer.getAvailablePorts()).toEqual([])
    expect(await ArduinoIDEIntegration.getArduinoIDEVersion()).toBeNull()
    expect(await ArduinoIDEIntegration.isArduinoIDEInstalled()).toBe(false)
    expect(await ArduinoIDEIntegration.installBoard('arduino:avr')).toBe(false)
    expect(await ArduinoIDEIntegration.updateBoardIndex()).toBe(false)
    expect(await ArduinoIDEIntegration.programFPGA('/tmp/fabric.bit', 'ice40')).toBe(false)
  })

  it('returns false from an IDE-open attempt rather than throwing', async () => {
    expect(await ArduinoIDEIntegration.openInArduinoIDE('void setup() {}')).toBe(false)
  })

  it('compiles via static analysis and refuses upload transport', async () => {
    boardProgrammer.setBoard('arduino_uno')
    boardProgrammer.setBrowserTransport(null)
    const compiled = await boardProgrammer.compileSketch('void setup() {} void loop() {}')
    expect(compiled.success).toBe(true)
    // The honest caveat must travel with the result — this is analysis, not a build.
    expect(compiled.warnings.join(' ')).toContain('No vendor toolchain')

    const upload = await boardProgrammer.uploadSketch('COM3')
    expect(upload.success).toBe(false)
    expect(upload.error).toBe('No upload transport in the browser')
  })

  it('uploads in the browser when a transport is registered', async () => {
    const { STK_INSYNC, STK_OK } = await import('./uploadSession')
    boardProgrammer.setBoard('arduino_uno')
    // Scripted loopback: every command gets a clean INSYNC+OK, reads echo 0xFF.
    const listeners: Array<(data: Uint8Array) => void> = []
    boardProgrammer.setBrowserTransport({
      write: async (data: Uint8Array): Promise<void> => {
        const command = data[0] ?? 0
        const reply =
          command === 0x74
            ? Uint8Array.from([STK_INSYNC, ...new Array(128).fill(0xff), STK_OK])
            : Uint8Array.from([STK_INSYNC, STK_OK])
        queueMicrotask(() => listeners.forEach((listener) => listener(reply)))
      },
      onData: (callback: (data: Uint8Array) => void): void => {
        listeners.push(callback)
      },
    })
    // 128 bytes of 0xFF verify against the loopback's 0xFF echo.
    const binary = new Uint8Array(128).fill(0xff).buffer as ArrayBuffer
    const upload = await boardProgrammer.uploadSketch('COM3', binary)
    expect(upload.success).toBe(true)
    expect(upload.output).toContain('verified')
    boardProgrammer.setBrowserTransport(null)
  })
})
