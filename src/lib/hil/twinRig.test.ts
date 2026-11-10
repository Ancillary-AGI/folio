import { describe, expect, it } from 'vitest'
import { buildDemoBoard } from '../demo/demoBoard'
import { buildCircuitNetlist } from '../simulation/netlistBuilder'
import { ArduinoIDEIntegration } from '../programming/boardProgrammer'
import { createCircuitTwinRig } from './twinRig'
import { hilOutputsMatch } from './hilRig'

const rectifierNetlist = () => {
  const board = buildDemoBoard()
  return buildCircuitNetlist('rectifier', board.components, board.wires, { type: 'dc' })
}

describe('circuit twin rig', () => {
  it('exposes the nets it can drive and measure', () => {
    const rig = createCircuitTwinRig(rectifierNetlist())
    expect(rig.kind).toBe('twin')
    expect(rig.capabilities).toEqual(['analog'])
    expect(rig.driveNets).toContain('SRC')
    expect(rig.measureNets).toEqual(expect.arrayContaining(['SRC', 'MID', 'OUT']))
    expect(rig.measureNets).not.toContain('GND')
  })

  it('solves the rectifier forward drop instead of returning the authored expectation', async () => {
    const rig = createCircuitTwinRig(rectifierNetlist())
    await rig.apply({ analog: { SRC: 5 } })
    const measured = await rig.measure({ analog: { OUT: 4.5 } })
    const out = measured.analog!.OUT
    // 5 V less the 1N5817 drop (~0.43 V) and the 10 Ω source resistor at ~41 mA.
    expect(out).toBeGreaterThan(3.9)
    expect(out).toBeLessThan(4.4)
    expect(out).not.toBe(4.5)
  })

  it('blocks the reverse half-cycle to leakage, not to the drive level', async () => {
    const rig = createCircuitTwinRig(rectifierNetlist())
    await rig.apply({ analog: { SRC: -5 } })
    const measured = await rig.measure({ analog: { OUT: 0 } })
    expect(Math.abs(measured.analog!.OUT)).toBeLessThan(0.01)
  })

  it('refuses a net with no source, and a node that is not in the model', async () => {
    const rig = createCircuitTwinRig(rectifierNetlist())
    await expect(rig.apply({ analog: { OUT: 5 } })).rejects.toThrow(/no independent voltage source/)
    await rig.apply({ analog: { SRC: 5 } })
    await expect(rig.measure({ analog: { NOPE: 0 } })).rejects.toThrow(/not in the solved model/)
  })

  it('refuses firmware buses rather than pretending to drive them', async () => {
    const rig = createCircuitTwinRig(rectifierNetlist())
    await expect(rig.apply({ uart: 'AT' })).rejects.toThrow(/cannot drive UART/)
    await expect(rig.measure({ digital: { D3: true } })).rejects.toThrow(/cannot measure Digital GPIO/)
  })

  it('runs a whole suite through the engine and reports per-channel deltas', async () => {
    const rig = createCircuitTwinRig(rectifierNetlist())
    const session = await ArduinoIDEIntegration.setupHILTest({
      hardwareInterfaces: { analog: true },
      testCases: [
        {
          id: 'forward', name: 'Forward rail', inputs: { analog: { SRC: 5 } },
          expectedOutputs: { analog: { OUT: 4.5 } }, tolerances: { analog: { OUT: 0.5 } }, settlingTime: 1,
        },
        {
          id: 'reverse', name: 'Reverse rail', inputs: { analog: { SRC: -5 } },
          expectedOutputs: { analog: { OUT: 0 } }, tolerances: { analog: { OUT: 0.05 } }, settlingTime: 1,
        },
        {
          id: 'tight', name: 'Hand estimate without margin', inputs: { analog: { SRC: 5 } },
          expectedOutputs: { analog: { OUT: 4.5 } }, settlingTime: 1,
        },
      ],
    })
    const summary = await ArduinoIDEIntegration.runHILTest(session, rig)
    expect(summary.summary.totalTests).toBe(3)
    expect(summary.summary.passedTests).toBe(2)
    expect(summary.summary.failedTests).toBe(1)
    expect(summary.results.map((result) => result.passed)).toEqual([true, true, false])
    const tight = summary.results[2]
    expect(tight.verdicts?.[0].ok).toBe(false)
    expect(tight.verdicts?.[0].delta).toBeLessThan(-0.2)
    expect(tight.error).toBeUndefined()
    expect(session.status).toBe('completed')
  })

  it('still refuses closed when no rig is attached', async () => {
    const session = await ArduinoIDEIntegration.setupHILTest({
      hardwareInterfaces: { analog: true },
      testCases: [
        { id: 'bench', name: 'Bench', inputs: { analog: { SRC: 5 } }, expectedOutputs: { analog: { OUT: 4.5 } }, settlingTime: 1 },
      ],
    })
    const summary = await ArduinoIDEIntegration.runHILTest(session)
    expect(summary.success).toBe(false)
    expect(summary.results[0].error).toMatch(/requires connected hardware/)
    expect(summary.results[0].verdicts?.[0].measured).toBe('—')
  })

  it('reports a rig error as a case error, not as a pass', async () => {
    const rig = createCircuitTwinRig(rectifierNetlist())
    const session = await ArduinoIDEIntegration.setupHILTest({
      hardwareInterfaces: { analog: true, uart: true },
      testCases: [
        { id: 'uart', name: 'Firmware loop', inputs: { uart: 'AT' }, expectedOutputs: { uart: 'OK' }, settlingTime: 1 },
      ],
    })
    const summary = await ArduinoIDEIntegration.runHILTest(session, rig)
    expect(summary.success).toBe(false)
    expect(summary.results[0].error).toMatch(/cannot drive UART/)
    expect(hilOutputsMatch(summary.results[0].measuredOutputs, { uart: 'OK' })).toBe(false)
  })
})