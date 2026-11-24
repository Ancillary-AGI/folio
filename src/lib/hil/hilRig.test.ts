import { describe, expect, it } from 'vitest'
import {
  compareHilOutputs,
  formatBytes,
  hilOutputsMatch,
  parseHexBytes,
  payloadBuses,
  toBytes,
} from './hilRig'

describe('HIL channel comparison', () => {
  it('compares analog channels against their declared tolerance', () => {
    const verdicts = compareHilOutputs(
      { analog: { OUT: 4.15, RAIL: 3.3 } },
      { analog: { OUT: 4.5, RAIL: 3.3 } },
      { analog: { OUT: 0.5 } },
    )
    expect(verdicts.map((verdict) => verdict.ok)).toEqual([true, true])
    expect(verdicts[0].delta).toBeCloseTo(-0.35, 6)
    expect(verdicts[0].tolerance).toBe(0.5)
    expect(verdicts[1].tolerance).toBe(0.1)
  })

  it('fails an analog channel outside the default tolerance and names the margin', () => {
    const [verdict] = compareHilOutputs({ analog: { OUT: 4.15 } }, { analog: { OUT: 4.5 } })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('outside ±0.1 V')
    expect(hilOutputsMatch({ analog: { OUT: 4.15 } }, { analog: { OUT: 4.5 } })).toBe(false)
  })

  it('treats an unmeasured channel as a failure, never a silent pass', () => {
    const verdicts = compareHilOutputs({}, { digital: { D3: true }, analog: { OUT: 1 }, uart: 'OK' })
    expect(verdicts).toHaveLength(3)
    expect(verdicts.every((verdict) => !verdict.ok)).toBe(true)
    expect(verdicts.map((verdict) => verdict.measured)).toEqual(['—', '—', '—'])
    expect(verdicts[0].reason).toBe('pin was not measured')
  })

  it('compares digital levels exactly', () => {
    expect(hilOutputsMatch({ digital: { D3: false } }, { digital: { D3: true } })).toBe(false)
    expect(hilOutputsMatch({ digital: { D3: true, D4: false } }, { digital: { D3: true } })).toBe(true)
  })

  it('compares UART text, which the old engine ignored entirely', () => {
    expect(hilOutputsMatch({ uart: 'READY\n' }, { uart: 'READY\n' })).toBe(true)
    expect(hilOutputsMatch({ uart: 'READY' }, { uart: 'READY\n' })).toBe(false)
    const [verdict] = compareHilOutputs({ uart: 'ERR' }, { uart: 'OK' })
    expect(verdict.reason).toBe('response differs')
  })

  it('matches CAN frames by id and compares payloads byte for byte', () => {
    const expected = { can: [{ id: 0x1f2, data: Uint8Array.from([1, 2, 3]) }] }
    expect(hilOutputsMatch({ can: [{ id: 0x1f2, data: Uint8Array.from([1, 2, 3]) }] }, expected)).toBe(true)
    expect(hilOutputsMatch({ can: [{ id: 0x1f2, data: Uint8Array.from([1, 2, 4]) }] }, expected)).toBe(false)
    const [missing] = compareHilOutputs({ can: [{ id: 0x100, data: Uint8Array.from([1, 2, 3]) }] }, expected)
    expect(missing.ok).toBe(false)
    expect(missing.reason).toBe('no frame with this id was measured')
  })

  it('compares SPI and I²C payloads, including an addressed I²C expectation', () => {
    expect(hilOutputsMatch({ spi: Uint8Array.from([0xa0, 0x01]) }, { spi: Uint8Array.from([0xa0, 0x01]) })).toBe(true)
    expect(hilOutputsMatch({ spi: Uint8Array.from([0xa0]) }, { spi: Uint8Array.from([0xa0, 0x01]) })).toBe(false)
    expect(
      hilOutputsMatch(
        { i2c: { address: 0x50, data: Uint8Array.from([1, 2]) } },
        { i2c: { address: 0x50, data: Uint8Array.from([1, 2]) } },
      ),
    ).toBe(true)
    expect(hilOutputsMatch({ i2c: Uint8Array.from([1, 2]) }, { i2c: Uint8Array.from([1, 3]) })).toBe(false)
  })

  it('passes a case that asserts nothing it cannot measure', () => {
    expect(compareHilOutputs({}, {})).toEqual([])
    expect(hilOutputsMatch({}, {})).toBe(true)
  })
})

describe('HIL byte helpers', () => {
  it('normalises the three spellings a byte array survives JSON as', () => {
    expect(Array.from(toBytes(Uint8Array.from([1, 2]))!)).toEqual([1, 2])
    expect(Array.from(toBytes([1, 2])!)).toEqual([1, 2])
    expect(Array.from(toBytes({ 0: 1, 1: 2 })!)).toEqual([1, 2])
    expect(toBytes({ data: 'nope' })).toBeNull()
    expect(toBytes([256])).toBeNull()
    expect(toBytes('01 02')).toBeNull()
  })

  it('formats bytes and frames for a verdict table', () => {
    expect(formatBytes(Uint8Array.from([0x0a, 0xff]))).toBe('0A FF')
    expect(formatBytes(Uint8Array.from([]))).toBe('(empty)')
    expect(formatBytes(undefined)).toBe('—')
  })

  it('parses hex payloads and rejects anything that is not a byte', () => {
    expect(Array.from(parseHexBytes('01 a0 FF')!)).toEqual([1, 160, 255])
    expect(Array.from(parseHexBytes('0x01,0x02')!)).toEqual([1, 2])
    expect(parseHexBytes('')!.length).toBe(0)
    expect(parseHexBytes('100')).toBeNull()
    expect(parseHexBytes('zz')).toBeNull()
  })

  it('reports the buses a payload uses', () => {
    expect(payloadBuses({ analog: { OUT: 1 }, uart: 'x' })).toEqual(['analog', 'uart'])
    expect(payloadBuses({})).toEqual([])
  })
})