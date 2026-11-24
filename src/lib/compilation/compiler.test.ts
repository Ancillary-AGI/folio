import { describe, expect, it } from 'vitest'
import {
  ArduinoCompiler,
  CompilerManager,
  analyseSource,
  buildFirmwareImage,
  buildNetMap,
  compilerManager,
  type CompilerOptions,
} from './compiler'
import { parseIntelHex } from './intelHex'
import type { Component, Net, Pin, Wire } from '../../types/index'

function pin(id: string, name: string, type: Pin['type']): Pin {
  return { id, name, x: 0, y: 0, type }
}

function component(id: string, name: string, category: string, pins: Pin[]): Component {
  return {
    id,
    name,
    category,
    symbol: { width: 10, height: 10, paths: [] },
    pins,
    properties: {},
  }
}

function wire(id: string, netName: string, ...connectedPins: Array<[string, string]>): Wire {
  return {
    id,
    points: [],
    netName,
    connectedPins: connectedPins.map(([componentId, pinId]) => ({ componentId, pinId })),
  }
}

const mcu = () =>
  component('mcu', 'Arduino Uno', 'microcontroller', [
    pin('d2', 'D2', 'io'),
    pin('d3', 'D3', 'io'),
    pin('a0', 'A0', 'input'),
    pin('gnd', 'GND', 'ground'),
  ])

const sensor = () =>
  component('sensor', 'Temperature Sensor', 'sensor', [
    pin('vcc', 'VCC', 'power'),
    pin('gnd', 'GND', 'ground'),
    pin('out', 'OUT', 'output'),
  ])

const led = () =>
  component('led', 'LED', 'semiconductor', [
    pin('anode', 'A', 'input'),
    pin('cathode', 'K', 'output'),
  ])

const options = (overrides: Partial<CompilerOptions> = {}): CompilerOptions => ({
  target: 'arduino',
  optimization: 'balanced',
  debug: false,
  warnings: true,
  includes: [],
  defines: {},
  libraries: [],
  ...overrides,
})

describe('buildNetMap', () => {
  it('merges named nets and wires onto the same pin', () => {
    const nets: Net[] = [
      { id: 'net1', name: 'SENSE', connectedPins: [{ componentId: 'mcu', pinId: 'd2' }], wires: [] },
    ]
    const wires = [wire('w1', 'SENSE', ['sensor', 'out'])]

    const map = buildNetMap(wires, nets)

    expect(map.get('mcu\u0000d2')).toBe('SENSE')
    expect(map.get('sensor\u0000out')).toBe('SENSE')
  })

  it('rejects a pin claimed by two differently named nets', () => {
    const wires = [wire('w1', 'A', ['mcu', 'd2']), wire('w2', 'B', ['mcu', 'd2'])]
    expect(() => buildNetMap(wires, [])).toThrow(/multiple nets/)
  })

  it('ignores unnamed wires instead of joining everything to one empty net', () => {
    expect(buildNetMap([wire('w1', '   ', ['mcu', 'd2'])], []).size).toBe(0)
  })
})

describe('analyseSource', () => {
  const requireEntryPoints = { requireSetupAndLoop: true }

  it('accepts a balanced sketch with entry points', () => {
    const result = analyseSource('void setup() {}\nvoid loop() { delay(1); }\n', requireEntryPoints)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.flashEstimate).toBeGreaterThan(0)
    expect(result.ramEstimate).toBeGreaterThan(0)
  })

  it('reports unmatched braces and missing entry points with positions', () => {
    const result = analyseSource('void setup() {\n  if (true) {\n}\n', requireEntryPoints)
    const messages = result.errors.map((error) => error.message)
    expect(messages).toContain("Unclosed '{'")
    expect(messages).toContain('Missing loop() entry point')
    const unclosed = result.errors.find((error) => error.message === "Unclosed '{'")!
    expect(unclosed.line).toBe(1)
  })

  it('ignores brackets and braces inside strings and block comments', () => {
    const code = 'void setup() {}\nvoid loop() { /* } { */ const char* s = "}"; }\n'
    expect(analyseSource(code, requireEntryPoints).errors).toEqual([])
  })

  it('reports unterminated strings and merge markers', () => {
    const result = analyseSource('void setup() {}\nvoid loop() { const char* s = "oops; }\n<<<<<<< HEAD\n', requireEntryPoints)
    const messages = result.errors.map((error) => error.message)
    expect(messages).toContain('Unterminated string literal')
    expect(messages).toContain('Unresolved merge conflict markers')
  })

  it('warns about non-ASCII text and missing timing calls', () => {
    const result = analyseSource('void setup() {}\nvoid loop() { const char* s = "°"; }\n', requireEntryPoints)
    expect(result.warnings.some((warning) => /Non-ASCII/.test(warning.message))).toBe(true)
    expect(result.warnings.some((warning) => /no timing call/.test(warning.message))).toBe(true)
  })
})

describe('buildFirmwareImage', () => {
  it('wraps the source in a valid Intel HEX image with a NUL terminator', () => {
    const source = 'void setup() {}\nvoid loop() {}\n'
    const image = buildFirmwareImage(source)
    const parsed = parseIntelHex(image.hex)
    if ('error' in parsed) throw new Error(parsed.error)

    expect(parsed.bytes).toEqual(new Uint8Array([...new TextEncoder().encode(source), 0]))
    expect(image.imageBytes).toBe(source.length + 1)
    expect(image.baseAddress).toBe(0)
  })

  it('honours a non-zero base address', () => {
    const image = buildFirmwareImage('x', 0x10000)
    expect(image.baseAddress).toBe(0x10000)
    expect(parseIntelHex(image.hex)).not.toHaveProperty('error')
  })
})

describe('schematic compilation', () => {
  it('reads a sensor output and drives a peripheral input through the MCU', async () => {
    const wires = [
      wire('w-sense', 'sensor_out', ['mcu', 'd2'], ['sensor', 'out']),
      wire('w-drive', 'led_drive', ['mcu', 'd3'], ['led', 'anode']),
    ]

    const result = await new ArduinoCompiler().compile([mcu(), sensor(), led()], wires, [], options())

    expect(result.success).toBe(true)
    expect(result.code).toContain('pinMode(D2, INPUT);')
    expect(result.code).toContain('int Temperature_SensorValue = digitalRead(D2);')
    expect(result.code).toContain('pinMode(D3, OUTPUT);')
    expect(result.code).toContain('digitalWrite(D3, LOW);')
    expect(result.code).toContain('#define NET_sensor_out "sensor_out"')
    expect(result.code).toContain('#define Temperature_Sensor_OUT_NET NET_sensor_out')
    expect(result.code).toContain('void setup()')
    expect(result.code).toContain('void loop()')
    expect(parseIntelHex(result.hex!)).not.toHaveProperty('error')
  })

  it('uses analogRead and analogWrite for analog and PWM pins', async () => {
    const pwmDevice = component('servo', 'Servo Motor', 'actuator', [pin('pwm', 'PWM', 'input')])
    const sensorAnalog = component('thermo', 'Thermistor', 'sensor', [pin('out', 'OUT', 'output')])
    const wires = [
      wire('w-a', 'analog_sense', ['mcu', 'a0'], ['thermo', 'out']),
      wire('w-b', 'servo_pwm', ['mcu', 'd3'], ['servo', 'pwm']),
    ]

    const result = await new ArduinoCompiler().compile([mcu(), sensorAnalog, pwmDevice], wires, [], options())

    expect(result.success).toBe(true)
    expect(result.code).toContain('pinMode(A0, INPUT);')
    expect(result.code).toContain('int ThermistorValue = analogRead(A0);')
    expect(result.code).toContain('analogWrite(D3, 0);')
  })

  it('includes libraries, custom includes and defines, and records the options', async () => {
    const result = await new ArduinoCompiler().compile(
      [mcu()],
      [],
      [],
      options({ libraries: ['Servo'], includes: ['<EEPROM.h>'], defines: { DEBUG: '1' }, optimization: 'size', debug: true }),
    )

    expect(result.success).toBe(true)
    expect(result.code).toContain('#include <Servo.h>')
    expect(result.code).toContain('#include <EEPROM.h>')
    expect(result.code).toContain('#define DEBUG 1')
    expect(result.code).toContain('optimization: size, debug: on')
  })

  it('keeps macros unique and valid when net names collide or start with a digit', async () => {
    const wires = [
      wire('w1', '3V3 rail', ['mcu', 'd2']),
      wire('w2', 'A-B', ['mcu', 'd3']),
      wire('w3', 'A B', ['sensor', 'out']),
    ]

    const result = await new ArduinoCompiler().compile([mcu(), sensor()], wires, [], options())

    expect(result.success).toBe(true)
    expect(result.code).toContain('#define NET__3V3_rail "3V3 rail"')
    expect(result.code).toContain('#define NET_A_B "A-B"')
    expect(result.code).toContain('#define NET_A_B_2 "A B"')
    const macroNames = [...result.code.matchAll(/^#define (\S+) /gm)].map((match) => match[1])
    expect(new Set(macroNames).size).toBe(macroNames.length)
  })

  it('reports contradictory net assignments as a fatal error instead of picking one', async () => {
    const wires = [wire('w1', 'ONE', ['mcu', 'd2']), wire('w2', 'TWO', ['mcu', 'd2'])]
    const result = await new ArduinoCompiler().compile([mcu()], wires, [], options())

    expect(result.success).toBe(false)
    expect(result.code).toBe('')
    expect(result.errors[0].severity).toBe('fatal')
    expect(result.errors[0].message).toMatch(/multiple nets/)
  })

  it('rejects include and define values that would break out of the generated code', async () => {
    const newline = await new ArduinoCompiler().compile(
      [mcu()],
      [],
      [],
      options({ libraries: ['Servo>\nvoid evil() {}'] }),
    )
    expect(newline.success).toBe(false)
    expect(newline.errors[0].message).toMatch(/Invalid library include name/)

    const badDefine = await new ArduinoCompiler().compile(
      [mcu()],
      [],
      [],
      options({ defines: { 'NOT A NAME': '1' } }),
    )
    expect(badDefine.success).toBe(false)
    expect(badDefine.errors[0].message).toMatch(/Invalid preprocessor define name/)

    const multiLine = await new ArduinoCompiler().compile(
      [mcu()],
      [],
      [],
      options({ defines: { FLAG: '1\nvoid evil() {}' } }),
    )
    expect(multiLine.success).toBe(false)
    expect(multiLine.errors[0].message).toMatch(/spans multiple lines/)
  })

  it('does not crash on legacy input/output parts without pins', async () => {
    const emptyInput = component('in', 'Bare Input', 'input', [])
    const result = await new ArduinoCompiler().compile([emptyInput], [], [], options())
    expect(result.success).toBe(true)
    expect(result.code).toContain('void loop()')
  })

  it('packages ESP32 sketches at the 0x10000 application address', async () => {
    const result = await compilerManager.compile([mcu()], [], [], options({ target: 'esp32' }))
    expect(result.success).toBe(true)
    expect(result.code).toContain('#include <WiFi.h>')
    expect(result.code).toContain('Serial.begin(115200);')
    expect(result.metadata.target).toBe('esp32')
    expect(result.output).toContain('0x10000')
  })

  it('throws for an unknown compiler target', async () => {
    await expect(compilerManager.compile([mcu()], [], [], options({ target: 'nope' }))).rejects.toThrow(/Unknown compiler target/)
  })
})

describe('CompilerManager', () => {
  it('routes boards to the matching target', () => {
    const manager = new CompilerManager()
    expect(manager.getTargetsForBoard('arduino_uno').map((target) => target.id)).toEqual(['arduino'])
    expect(manager.getTargetsForBoard('esp32_s3').map((target) => target.id)).toEqual(['esp32'])
    expect(manager.getTargetsForBoard('unknown_board')).toEqual([])
  })
})
