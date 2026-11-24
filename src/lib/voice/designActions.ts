/**
 * Real design edits from spoken commands.
 *
 * Placing a part and wiring two named references are deliberately small,
 * deterministic operations: they use the shipped library, the same world
 * coordinates the canvas uses, and the project store's undoable actions. When a
 * command cannot be carried out the result says so — nothing is reported as
 * applied unless the store really changed.
 */
import type { Component } from '../supabase'
import { standardComponents } from '../componentLibrary'
import { useProjectStore, type CanvasComponent, type CanvasWire } from '../../stores/useProjectStore'
import { pinWorldCoord } from '../schematic/drawingLayout'
import { generateId } from '../utils'

export interface DesignActionResult {
  applied: boolean
  detail: string
  [key: string]: unknown
}

/**
 * Spoken word → library part.
 *
 * Exported so the contract test can read every row: a phrase list written by
 * hand is a list that quietly stops covering the table.
 */
export const TYPE_ALIASES: ReadonlyArray<readonly [readonly string[], string]> = [
  // Aliases are singular: the spoken phrase is singularised before it is
  // compared, so an entry ending in "s" could never be reached.
  [['resistor', 'resistance'], 'Resistor'],
  [['capacitor', 'cap'], 'Capacitor'],
  [['inductor', 'coil'], 'Inductor'],
  [['transformer'], 'Transformer'],
  [['diode'], 'Diode'],
  [['led', 'light'], 'LED'],
  [['npn'], 'NPN Transistor'],
  [['pnp'], 'PNP Transistor'],
  [['transistor', 'bjt'], 'NPN Transistor'],
  [['mosfet', 'fet'], 'N-Channel MOSFET'],
  [['finfet'], 'N-Channel FinFET'],
  [['hemt', 'gan'], 'N-Channel GaN HEMT'],
  [['jfet'], 'N-Channel JFET'],
  [['opamp'], 'Op-Amp'],
  [['op', 'amp'], 'Op-Amp'],
  [['ground', 'gnd', 'earth'], 'Ground'],
  [['battery', 'source', 'supply'], 'DC Voltage Source'],
  [['regulator', 'ldo'], 'Voltage Regulator'],
  [['crystal', 'oscillator'], 'Crystal Oscillator'],
  [['button', 'switch'], 'Push Button'],
  [['header', 'connector'], 'Header Pin'],
  [['testpoint', 'probe'], 'Test Point'],
  [['servo', 'motor'], 'Servo Motor'],
  [['and'], 'Logic Gate AND'],
  [['or'], 'Logic Gate OR'],
  [['not', 'inverter'], 'Logic Gate NOT'],
  // Catalog parts: what the datasheet calls them, since the sheet places those
  // parts and no invented stand-in.
  [['arduino', 'atmega', 'microcontroller', 'mcu'], 'ATmega328P-PU AVR 8-bit microcontroller'],
  [['stm32', 'bluepill', 'cortex'], 'STM32F103C8T6 ARM Cortex-M3 microcontroller'],
  [['esp32', 'wifi', 'radio', 'esp'], 'ESP32-WROOM-32 WiFi + Bluetooth module'],
  [['eeprom', 'memory'], '24LC256 256Kbit I2C EEPROM'],
  [['flash'], 'W25Q128JV 128Mbit SPI flash'],
  [['shift', 'register'], '74HC595 8-bit shift register with latch'],
  [['decoder', 'mux'], '74HC138 3-to-8 inverting decoder'],
  [['relay'], 'SRD-05VDC-SL-C Relay 5V 10A SPDT'],
  [['usbc', 'usb'], 'TYPE-C-16P USB-C receptacle 16-pin'],
  [['barrel', 'jack', 'power'], 'PJ-102A DC barrel jack 2.1mm'],
  [['fuse'], 'FUSE-0805 Fuse 0805 SMD'],
  // The rest are asked for by part number, because that is how a person names
  // silicon. Where one word has exactly one part behind it in the catalog, the
  // word is allowed; where the catalog ships two, only the number resolves.
  [['rs485', 'max3485'], 'MAX3485 RS-485 transceiver 3.3V half-duplex'],
  [['cantransceiver', 'sn65hvd230'], 'SN65HVD230 CAN transceiver 3.3V'],
  [['rs232', 'max232'], 'MAX232CPL RS-232 transceiver with charge pump'],
  [['optocoupler', 'pc817'], 'PC817 Phototransistor optocoupler'],
  [['uln2003', 'driverarray'], 'ULN2003A Seven 500 mA Darlington driver array'],
  [['tip120'], 'TIP120 NPN Darlington transistor 60 V'],
  [['bss138'], 'BSS138 N-channel MOSFET 50 V SOT-23'],
  [['isolator', 'iso7741'], 'ISO7741DW Quad-channel digital isolator, 3 forward + 1 reverse'],
  [['levelshifter', 'txb0104'], 'TXB0104 4-bit bidirectional level translator'],
  [['pca9306'], 'PCA9306 2-bit I2C bus level translator'],
  [['ethernet', 'lan8720'], 'LAN8720A 10/100 Ethernet PHY with RMII'],
  [['lm358'], 'LM358 Dual op-amp, single supply'],
  [['tl072'], 'TL072 Dual JFET-input op-amp'],
  [['lm393'], 'LM393 Dual comparator, open-collector'],
  [['ina128'], 'INA128 Programmable-gain instrumentation amp'],
  [['ina180'], 'INA180A1 Current-sense amplifier 20 V/V'],
  [['adc', 'ads1115'], 'ADS1115 16-bit I2C ADC with PGA'],
  [['mcp4725'], 'MCP4725A0T-E/CH 12-bit I2C DAC with EEPROM'],
  [['dac8564'], 'DAC8564 Quad 16-bit SPI DAC'],
  [['tl431'], 'TL431ACDBZR Programmable shunt reference'],
  [['lm7805'], 'LM7805 5 V 3-terminal positive regulator'],
  [['lm317'], 'LM317T Adjustable positive regulator'],
  [['ams1117'], 'AMS1117-3.3 3.3 V 1 A low-dropout regulator'],
  [['tps54331', 'buck'], 'TPS54331DR 3 A step-down converter'],
  [['bme280', 'environmentalsensor'], 'BME280 Humidity, pressure and temperature sensor'],
  [['bmp280', 'barometer'], 'BMP280 Absolute barometric pressure sensor'],
  [['sht40', 'sht4x'], 'SHT40 Humidity and temperature sensor with heater'],
  [['veml6040', 'colorsensor'], 'VEML6040 RGB colour light sensor'],
  [['ds18b20', 'onewire'], 'DS18B20 1-Wire digital thermometer (TO-92)'],
]

const REFERENCE_PREFIX: ReadonlyArray<readonly [RegExp, string]> = [
  [/resistor/i, 'R'],
  [/capacitor/i, 'C'],
  [/inductor/i, 'L'],
  [/transformer/i, 'T'],
  [/diode|led/i, 'D'],
  [/transistor|mosfet|finfet|hemt|jfet/i, 'Q'],
  [/op-amp|arduino|eeprom|lcd|regulator|wifi|sensor/i, 'U'],
  [/fuse/i, 'F'],
  [/relay/i, 'K'],
  [/crystal|oscillator/i, 'Y'],
  [/switch|button/i, 'SW'],
  [/header|pin|jack|usb|receptacle/i, 'J'],
  [/ground/i, 'G'],
  [/source|battery/i, 'V'],
  [/test/i, 'TP'],
]

const tokensOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

const singular = (token: string): string =>
  token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token

/** The library part a phrase asks for, or null when nothing matches. */
export function libraryPartForText(text: string): string | null {
  const tokens = tokensOf(text).map(singular)
  for (const [aliases, name] of TYPE_ALIASES) {
    if (aliases.some((alias) => tokens.includes(alias))) return name
  }
  return null
}

function nextReference(name: string, used: ReadonlySet<string>): string {
  const prefix = REFERENCE_PREFIX.find(([pattern]) => pattern.test(name))?.[1] ?? 'U'
  let index = 1
  while (used.has(`${prefix}${index}`)) index += 1
  return `${prefix}${index}`
}

const boundsOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  margin: number,
): boolean =>
  a.x < b.x + b.width + margin &&
  a.x + a.width + margin > b.x &&
  a.y < b.y + b.height + margin &&
  a.y + a.height + margin > b.y

/** First free slot on a coarse grid, so a spoken part never lands on another. */
function findFreeOrigin(
  width: number,
  height: number,
  occupied: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
): { x: number; y: number } {
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const candidate = {
        x: 80 + column * 140,
        y: 80 + row * 120,
        width,
        height,
      }
      if (!occupied.some((bounds) => boundsOverlap(candidate, bounds, 24))) {
        return { x: candidate.x, y: candidate.y }
      }
    }
  }
  return { x: 80 + (occupied.length % 7) * 140, y: 80 + Math.floor(occupied.length / 7) * 120 }
}

/** Place a library part named in the phrase. The store action is undoable. */
export function placeComponentFromText(text: string): DesignActionResult {
  const name = libraryPartForText(text)
  if (!name) {
    return {
      applied: false,
      detail: `I could not tell which part you meant. Try “place a resistor” or “add a capacitor”.`,
    }
  }
  const template = standardComponents.find((part) => part.name === name)
  if (!template) {
    return { applied: false, detail: `The library has no “${name}” part, so nothing was placed.` }
  }

  const project = useProjectStore.getState()
  const usedReferences = new Set(project.components.map((component) => component.reference))
  const reference = nextReference(name, usedReferences)
  const occupied = project.components.map((component) => ({
    x: component.x,
    y: component.y,
    width: component.component.symbol_data.width,
    height: component.component.symbol_data.height,
  }))
  const origin = findFreeOrigin(template.symbol_data.width, template.symbol_data.height, occupied)

  const part: Component = {
    ...template,
    id: generateId('lib'),
    created_at: new Date().toISOString(),
  }
  const placed: CanvasComponent = {
    id: generateId('comp'),
    componentId: part.id ?? part.name,
    component: part,
    x: origin.x,
    y: origin.y,
    rotation: 0,
    reference,
    properties: { ...template.default_properties },
  }
  project.addComponent(placed)
  return {
    applied: true,
    detail: `Placed ${reference} (${name}) at ${origin.x}, ${origin.y}.`,
    reference,
    name,
    x: origin.x,
    y: origin.y,
  }
}

interface NamedPart {
  component: CanvasComponent
  pinIndex: number
}

/** Match a phrase side to the placed parts by reference, then by part name. */
function findPart(side: string[], components: readonly CanvasComponent[]): NamedPart | null {
  const pinAt = side.indexOf('pin')
  const pinNumber = pinAt >= 0 ? Number(side[pinAt + 1]) : NaN
  const pinIndex = Number.isFinite(pinNumber) && pinNumber >= 1 ? Math.floor(pinNumber) - 1 : 0

  const byReference = components.find((component) =>
    side.includes(component.reference.toLowerCase()),
  )
  if (byReference) return { component: byReference, pinIndex }

  let best: CanvasComponent | null = null
  let bestWords = 0
  for (const component of components) {
    const words = tokensOf(component.component.name).map(singular)
    if (!words.every((word) => side.includes(word))) continue
    if (words.length > bestWords) {
      best = component
      bestWords = words.length
    }
  }
  return best ? { component: best, pinIndex } : null
}

const pinName = (component: CanvasComponent, index: number): string => {
  const pin = component.component.pins[index]
  return pin ? `${component.reference}.${pin.name || pin.id}` : `${component.reference}.?`
}

/** Wire two named references with an orthogonal route. Undoable. */
export function connectPartsFromText(text: string): DesignActionResult {
  const tokens = tokensOf(text)
  const toIndex = tokens.indexOf('to')
  const connectIndex = tokens.findIndex((token) =>
    ['connect', 'wire', 'link', 'join', 'route', 'attach'].includes(token),
  )
  if (toIndex < 0 || connectIndex < 0 || toIndex <= connectIndex + 1) {
    return {
      applied: false,
      detail: 'Name both ends, for example “connect R1 to D1”.',
    }
  }
  if (tokens.length <= toIndex + 1) {
    return { applied: false, detail: 'I heard the first end but not the second. Try “connect R1 to D1”.' }
  }

  const project = useProjectStore.getState()
  const from = findPart(tokens.slice(connectIndex + 1, toIndex), project.components)
  const to = findPart(tokens.slice(toIndex + 1), project.components)
  if (!from || !to) {
    const available = project.components.map((component) => component.reference).join(', ') || 'none'
    const missing = !from && !to ? 'both ends' : !from ? 'the first end' : 'the second end'
    return {
      applied: false,
      detail: `I could not find ${missing} on this sheet. Placed references: ${available}.`,
    }
  }
  if (from.component.id === to.component.id) {
    return { applied: false, detail: 'Both names point at the same part, so no wire was drawn.' }
  }
  const fromPin = from.component.component.pins[from.pinIndex]
  const toPin = to.component.component.pins[to.pinIndex]
  if (!fromPin || !toPin) {
    return {
      applied: false,
      detail: `${from.component.reference} or ${to.component.reference} has no pin ${Math.max(from.pinIndex, to.pinIndex) + 1}.`,
    }
  }

  const start = pinWorldCoord(from.component, fromPin)
  const end = pinWorldCoord(to.component, toPin)
  const midX = Math.round((start.x + end.x) / 20) * 10
  const points =
    Math.abs(start.y - end.y) < 1e-6
      ? [{ ...start }, { ...end }]
      : [{ ...start }, { x: midX, y: start.y }, { x: midX, y: end.y }, { ...end }]

  const netNumber =
    project.wires.reduce((highest, wire) => {
      const match = wire.netName?.match(/^NET(\d+)$/)
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0) + 1
  const wire: CanvasWire = {
    id: generateId('wire'),
    points,
    netName: `NET${netNumber}`,
    connectedPins: [
      { componentId: from.component.id, pinId: fromPin.id },
      { componentId: to.component.id, pinId: toPin.id },
    ],
  }
  project.addWire(wire)
  return {
    applied: true,
    detail: `Connected ${pinName(from.component, from.pinIndex)} to ${pinName(to.component, to.pinIndex)} on NET${netNumber}.`,
    from: from.component.reference,
    to: to.component.reference,
  }
}
