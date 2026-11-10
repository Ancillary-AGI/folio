import { describe, expect, it } from 'vitest'
import {
  buildCase, buildSuite, cloneCase, defaultSuite, draftBuses, draftFromTestCase, emptyCase,
  parseId, parseNumber, verdictRows, verdictsToCSV, type CaseDraft, type SuiteDesign,
} from './suite'
import type { HILTestCase } from '../programming/boardProgrammer'

const reference: HILTestCase = {
  id: 'rail', name: 'Rail charges', inputs: { analog: { SRC: 5 } },
  expectedOutputs: { analog: { OUT: 4.5 } }, tolerances: { analog: { OUT: 0.5 } }, settlingTime: 20,
}

const suiteWith = (cases: CaseDraft[], over: Partial<SuiteDesign> = {}): SuiteDesign => ({
  ...defaultSuite([reference]),
  cases,
  ...over,
})

const caseWith = (over: Partial<CaseDraft> = {}): CaseDraft => ({ ...emptyCase(1), ...over })

describe('HIL suite drafts', () => {
  it('round-trips an engine case through the editable draft', () => {
    const draft = draftFromTestCase(reference)
    expect(draft.id).toBe('rail')
    expect(draft.settlingMs).toBe('20')
    expect(draft.inputs.analog[0]).toMatchObject({ channel: 'SRC', value: '5' })
    expect(draft.expected.analog[0]).toMatchObject({ channel: 'OUT', value: '4.5', tolerance: '0.5' })
    const built = buildCase(draft, { digital: false, analog: true, can: false, spi: false, i2c: false, uart: false })
    expect(built.problems).toEqual([])
    expect(built.testCase).toMatchObject({
      id: 'rail', inputs: { analog: { SRC: 5 } }, expectedOutputs: { analog: { OUT: 4.5 } },
      tolerances: { analog: { OUT: 0.5 } }, settlingTime: 20,
    })
  })

  it('keeps a partially typed number as text and refuses it at build time', () => {
    const draft = caseWith()
    draft.inputs.analog = [{ key: 'a', channel: 'SRC', value: '-', tolerance: '' }]
    draft.expected.analog = [{ key: 'b', channel: 'OUT', value: '4.', tolerance: '' }]
    const built = buildCase(draft, { digital: false, analog: true, can: false, spi: false, i2c: false, uart: false })
    expect(built.testCase).toBeNull()
    expect(built.problems.map((problem) => problem.message).join(' ')).toMatch(/is not a number \("-"\)/)
    expect(parseNumber('4.')).toBe(4)
    expect(parseNumber('4.5V')).toBe(4.5)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
  })

  it('refuses a case that asserts nothing', () => {
    const built = buildCase(caseWith(), { digital: false, analog: true, can: false, spi: false, i2c: false, uart: false })
    expect(built.testCase).toBeNull()
    expect(built.problems[0].message).toMatch(/no stimulus and no assertion/)
  })

  it('refuses a bus that is switched off', () => {
    const draft = draftFromTestCase(reference)
    const built = buildCase(draft, { digital: false, analog: false, can: false, spi: false, i2c: false, uart: false })
    expect(built.testCase).toBeNull()
    expect(built.problems.map((problem) => problem.message).join(' ')).toMatch(/uses ANALOG I\/O but that interface is switched off/)
  })

  it('validates hex payloads, CAN length and I²C addresses', () => {
    const interfaces = { digital: false, analog: false, can: true, spi: true, i2c: true, uart: false }
    const draft = caseWith()
    draft.inputs.can = [{ key: 'c', id: '0x1F2', data: '01 02' }]
    draft.inputs.spi = { active: true, hex: 'A0 FF' }
    draft.inputs.i2c = { active: true, address: '0x50', hex: '01' }
    draft.expected.uart = { active: true, text: '' }
    const good = buildCase(draft, { ...interfaces, uart: true })
    expect(good.problems).toEqual([])
    expect(good.testCase?.inputs.can?.[0].id).toBe(0x1f2)
    expect(Array.from(good.testCase!.inputs.spi!)).toEqual([0xa0, 0xff])
    expect(good.testCase?.expectedOutputs.uart).toBe('')

    draft.inputs.can = [{ key: 'c', id: '0x1F2', data: '01 02 03 04 05 06 07 08 09' }]
    draft.inputs.spi = { active: true, hex: 'ZZ' }
    draft.inputs.i2c = { active: true, address: '0x90', hex: '01' }
    const bad = buildCase(draft, { ...interfaces, uart: true })
    expect(bad.testCase).toBeNull()
    const messages = bad.problems.map((problem) => problem.message).join('\n')
    expect(messages).toMatch(/classical CAN allows 8/)
    expect(messages).toMatch(/not hex bytes/)
    expect(messages).toMatch(/7-bit integer/)
  })

  it('parses identifiers written in hex or decimal', () => {
    expect(parseId('0x1F2')).toBe(498)
    expect(parseId('498')).toBe(498)
    expect(parseId('-1')).toBeNull()
    expect(parseId('1.5')).toBeNull()
    expect(parseId('')).toBeNull()
  })

  it('reports the buses a draft uses', () => {
    const draft = draftFromTestCase(reference)
    expect(draftBuses(draft)).toEqual(['analog'])
    draft.inputs.uart = { active: true, text: 'AT' }
    expect(draftBuses(draft)).toEqual(['analog', 'uart'])
  })

  it('clones a case with fresh row keys and a distinct id', () => {
    const draft = draftFromTestCase(reference)
    const copy = cloneCase(draft, 1)
    expect(copy.key).not.toBe(draft.key)
    expect(copy.id).toBe('rail-copy')
    expect(copy.inputs.analog[0].key).not.toBe(draft.inputs.analog[0].key)
    expect(copy.inputs.analog[0].channel).toBe('SRC')
    expect(cloneCase(draft, 2).id).toBe('rail-copy-2')
  })
})

describe('HIL suite assembly', () => {
  it('builds a coherent config and keeps the authored order', () => {
    const design = suiteWith([draftFromTestCase(reference), { ...draftFromTestCase(reference), id: 'rail-2', name: 'Second' }])
    const built = buildSuite(design)
    expect(built.problems).toEqual([])
    expect(built.config?.testCases.map((entry) => entry.id)).toEqual(['rail', 'rail-2'])
    expect(built.config?.samplingRate).toBe(1000)
    expect(built.config?.timeout).toBe(5000)
  })

  it('refuses duplicate ids and names both cases', () => {
    const design = suiteWith([draftFromTestCase(reference), draftFromTestCase(reference)])
    const built = buildSuite(design)
    expect(built.config).toBeNull()
    expect(built.problems.map((problem) => problem.message).join(' ')).toMatch(/already used by "Rail charges"/)
  })

  it('skips disabled cases but still validates the rest', () => {
    const disabled = { ...draftFromTestCase(reference), id: 'off', enabled: false }
    const design = suiteWith([draftFromTestCase(reference), disabled])
    expect(buildSuite(design).config?.testCases.map((entry) => entry.id)).toEqual(['rail'])
    expect(buildSuite(design, { includeDisabled: true }).config?.testCases).toHaveLength(2)
  })

  it('blocks the suite when no interface is enabled or no case is left', () => {
    const design = suiteWith([draftFromTestCase(reference)], {
      interfaces: { digital: false, analog: false, can: false, spi: false, i2c: false, uart: false },
    })
    const built = buildSuite(design)
    expect(built.config).toBeNull()
    expect(built.problems.some((problem) => problem.caseKey === null && /at least one hardware interface/.test(problem.message))).toBe(true)
    expect(buildSuite(suiteWith([])).problems.some((problem) => /no enabled test cases/.test(problem.message))).toBe(true)
  })

  it('rejects a non-positive sampling rate and timeout', () => {
    const design = suiteWith([draftFromTestCase(reference)], { samplingHz: '0', timeoutMs: '-5' })
    const messages = buildSuite(design).problems.map((problem) => problem.message).join(' ')
    expect(messages).toMatch(/Sampling rate must be a positive number/)
    expect(messages).toMatch(/Timeout must be a positive number/)
  })

  it('still runs the clean cases when one case is broken', () => {
    const broken = caseWith({ id: 'broken', name: 'Broken' })
    const design = suiteWith([draftFromTestCase(reference), broken])
    const built = buildSuite(design)
    expect(built.problems.length).toBeGreaterThan(0)
    expect(built.config?.testCases.map((entry) => entry.id)).toEqual(['rail'])
  })
})

describe('HIL verdict export', () => {
  const results = [
    {
      testCaseId: 'rail', passed: false, duration: 12, error: undefined,
      verdicts: [
        { bus: 'analog', channel: 'OUT', expected: '4.5 V', measured: '4.15 V', delta: -0.35, tolerance: 0.1, ok: false, reason: 'outside ±0.1 V' },
      ],
    },
    { testCaseId: 'silent', passed: false, duration: 3, error: 'no hardware', verdicts: [] },
  ]

  it('emits one row per channel and keeps a case-level error row', () => {
    const rows = verdictRows(results, { rail: 'Rail charges' })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ caseId: 'rail', caseName: 'Rail charges', channel: 'OUT', status: 'fail', reason: 'outside ±0.1 V' })
    expect(rows[1]).toMatchObject({ caseId: 'silent', status: 'fail', error: 'no hardware' })
  })

  it('quotes CSV cells that contain a comma, quote or newline', () => {
    const csv = verdictsToCSV([
      { caseId: 'a,b', caseName: 'He said "go"\nnow', bus: 'uart', channel: 'TX', expected: '"OK"', measured: '', status: 'fail', durationMs: 1 },
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('case_id,case_name,bus,channel,expected,measured,delta_v,tolerance_v,status,reason,duration_ms,error')
    expect(lines[1]).toContain('"a,b"')
    expect(lines[1]).toContain('"He said ""go""\nnow"')
    expect(lines[1]).toContain('"""OK"""')
  })
})