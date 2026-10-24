import { describe, expect, it } from 'vitest'
import { parseDatasheetText, synthesizeComponentFromDatasheet } from '../ai/datasheetParser'
import { DEMO_DATASHEET_TEXT } from './demoDatasheet'

describe('datasheet demo', () => {
  it('parses into a 16-pin ADC with a complete synthesized part', () => {
    const parsed = parseDatasheetText(DEMO_DATASHEET_TEXT)
    expect(parsed.partNumber).toBe('MCP3008-I/SL')
    expect(parsed.pins).toHaveLength(16)
    expect(parsed.packaging.packageName).toBe('SOIC-16')
    expect(parsed.electrical.minSupplyVoltageV).toBe(2.7)
    expect(parsed.electrical.maxSupplyVoltageV).toBe(5.5)

    const synthesized = synthesizeComponentFromDatasheet(parsed)
    expect(synthesized.component.pins).toHaveLength(16)
    expect(synthesized.spiceSubcircuit).toContain('.SUBCKT MCP3008-I/SL')
  })
})
