import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'
import { generateArduinoProgram } from './visualProgram'

function node(id: string, type: string, data: Record<string, unknown>): Node {
  return { id, type, position: { x: 0, y: 0 }, data }
}

describe('generateArduinoProgram', () => {
  it('emits action statements even when a Loop entry block is present', () => {
    const code = generateArduinoProgram([
      node('loop', 'function', { label: 'Loop', functionName: 'loop', inputs: [] }),
      node('button', 'input', { type: 'digital', pin: 2 }),
      node('led', 'output', { type: 'digital', pin: 13 }),
      node('servo', 'output', { type: 'servo', pin: 9 }),
    ])

    expect(code).toContain('pinMode(2, INPUT)')
    expect(code).toContain('pinMode(13, OUTPUT)')
    expect(code).toContain('servo0.attach(9)')
    expect(code).toContain('digitalRead(2)')
    expect(code).toContain('digitalWrite(13, HIGH)')
    expect(code).toContain('delay(100)')
    expect(code).not.toContain('functionName')
  })

  it('keeps control blocks out of setup and inside the generated loop', () => {
    const code = generateArduinoProgram([
      node('loop', 'function', { functionName: 'loop' }),
      node('for', 'loop', { loopType: 'for', iterations: 4 }),
      node('wait', 'process', { operation: 'delay', parameters: { ms: 250 } }),
    ])

    expect(code).toContain('for (int i = 0; i < 4; i++)')
    expect(code).toContain('delay(250)')
    const loopIndex = code.indexOf('void loop()')
    expect(code.indexOf('for (int i = 0; i < 4; i++)')).toBeGreaterThan(loopIndex)
  })
})
