import { Component, Wire, Net, Pin } from '../../types/index';
import { bytesToIntelHex, textToBytes } from './intelHex';

// Compiler interface for different target platforms
export interface CompilerTarget {
  id: string;
  name: string;
  description: string;
  supportedBoards: string[];
  compile: (components: Component[], wires: Wire[], nets: Net[], options: CompilerOptions) => Promise<CompilationResult>;
}

export interface CompilerOptions {
  target: string;
  /** Recorded in the generated header; no vendor optimiser runs in the browser. */
  optimization: 'none' | 'speed' | 'size' | 'balanced';
  /** Recorded in the generated header; debug symbols are a toolchain concern. */
  debug: boolean;
  /** Display concern for the caller; diagnostics are always computed. */
  warnings: boolean;
  /** Header names included verbatim (angle brackets are optional). */
  includes: string[];
  defines: Record<string, string>;
  /** Library names; `.h` is appended. */
  libraries: string[];
}

export interface CompilationResult {
  success: boolean;
  output: string;
  /** The sketch that was analysed and packaged (empty when generation threw). */
  code: string;
  errors: CompilationError[];
  warnings: CompilationWarning[];
  binary?: ArrayBuffer;
  hex?: string;
  size: {
    flash: number;
    ram: number;
  };
  metadata: {
    compilationTime: number;
    target: string;
    version: string;
  };
}

export interface CompilationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'fatal';
  file?: string;
}

export interface CompilationWarning {
  line: number;
  column: number;
  message: string;
  severity: 'warning' | 'info';
  file?: string;
}

/** Turn arbitrary text into a legal C identifier fragment. */
function sanitizeIdentifier(text: string, fallback: string): string {
  const cleaned = text
    .trim()
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) return fallback
  // A leading digit is legal in a name but not at the start of an identifier.
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned
}

/** Escape a value for a double-quoted C string literal on one line. */
function cString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')
}

function generatePinMappings(
  platform: string,
  components: Component[],
  wires: Wire[],
  nets: Net[],
): string {
  const netByPin = buildNetMap(wires, nets)
  const usedMacros = new Set<string>()
  const uniqueMacro = (base: string): string => {
    let candidate = base
    let suffix = 2
    while (usedMacros.has(candidate)) {
      candidate = `${base}_${suffix}`
      suffix += 1
    }
    usedMacros.add(candidate)
    return candidate
  }

  const netMacros = new Map<string, string>()
  for (const name of new Set(netByPin.values())) {
    netMacros.set(name, uniqueMacro(`NET_${sanitizeIdentifier(name, 'UNNAMED')}`))
  }

  let mappings = `// ${platform} pin and net mappings\n`
  for (const [name, macro] of netMacros) {
    mappings += `#define ${macro} "${cString(name)}"\n`
  }
  for (const component of components) {
    for (const pin of component.pins) {
      const netName = netByPin.get(`${component.id}\u0000${pin.id}`)
      if (!netName) continue
      const componentMacro = sanitizeIdentifier(`${component.name}_${pin.name}`, 'PIN')
      mappings += `#define ${uniqueMacro(`${componentMacro}_NET`)} ${netMacros.get(netName)}\n`
    }
  }
  return mappings
}

/**
 * Reject option values that would produce broken or injected C++.
 * These are user-supplied through the UI, so they are checked at this boundary.
 */
function validateCompilerOptions(options: CompilerOptions): void {
  const includeName = /^[A-Za-z0-9_./-]+$/
  for (const library of options.libraries) {
    if (!includeName.test(library)) throw new Error(`Invalid library include name "${library}"`)
  }
  for (const include of options.includes) {
    const name = include.replace(/^<|>$/g, '')
    if (!includeName.test(name)) throw new Error(`Invalid include name "${include}"`)
  }
  for (const [key, value] of Object.entries(options.defines)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid preprocessor define name "${key}"`)
    }
    if (/[\r\n]/.test(value)) throw new Error(`Preprocessor define "${key}" spans multiple lines`)
  }
}

/** Pin-key separator; a NUL cannot appear in an identifier, so it is collision-free. */
const PIN_KEY = '\u0000'

/**
 * Map every connected pin to its net name.
 *
 * Rejects the contradictory case (one pin on two differently named nets) rather
 * than silently picking whichever came last — that would generate firmware wired
 * to the wrong net.
 */
export function buildNetMap(wires: readonly Wire[], nets: readonly Net[]): Map<string, string> {
  const netByPin = new Map<string, string>()
  const addConnection = (componentId: string, pinId: string, name: string): void => {
    const key = `${componentId}${PIN_KEY}${pinId}`
    const existing = netByPin.get(key)
    if (existing && existing !== name) {
      throw new Error(`Pin ${componentId}.${pinId} is assigned to multiple nets ("${existing}" and "${name}")`)
    }
    netByPin.set(key, name)
  }

  for (const net of nets) {
    for (const pin of net.connectedPins) addConnection(pin.componentId, pin.pinId, net.name)
  }
  for (const wire of wires) {
    const name = wire.netName?.trim()
    if (!name) continue
    for (const pin of wire.connectedPins) addConnection(pin.componentId, pin.pinId, name)
  }
  return netByPin
}

interface PinRef {
  component: Component
  pin: Pin
}

/** Group every connected pin by the net it belongs to. */
function groupPinsByNet(components: readonly Component[], wires: readonly Wire[], nets: readonly Net[]): Map<string, PinRef[]> {
  const netByPin = buildNetMap(wires, nets)
  const byNet = new Map<string, PinRef[]>()
  for (const component of components) {
    for (const pin of component.pins) {
      const netName = netByPin.get(`${component.id}${PIN_KEY}${pin.id}`)
      if (!netName) continue
      const refs = byNet.get(netName) ?? []
      refs.push({ component, pin })
      byNet.set(netName, refs)
    }
  }
  return byNet
}

const isMicrocontroller = (component: Component): boolean => component.category === 'microcontroller'
const isSignalPin = (pin: Pin): boolean => pin.type === 'input' || pin.type === 'output' || pin.type === 'io'
const isAnalogPinName = (name: string): boolean => /^A\d+$/i.test(name.trim())

/**
 * Net connections where exactly one MCU pin meets exactly one peripheral pin.
 *
 * A peripheral `output` pin (a sensor's OUT) is read by the MCU; a peripheral
 * `input` pin (an LED anode, a servo PWM input) is driven by the MCU. Nets with
 * several peripherals or no MCU are left to the named-mirror pass, because the
 * schematic does not say which part is in charge.
 */
function boardConnections(byNet: Map<string, PinRef[]>): Array<{
  netName: string
  mcu: PinRef
  device: PinRef
  direction: 'read' | 'drive'
}> {
  const connections: Array<{ netName: string; mcu: PinRef; device: PinRef; direction: 'read' | 'drive' }> = []
  for (const [netName, refs] of byNet) {
    const mcuRefs = refs.filter((ref) => isMicrocontroller(ref.component) && (ref.pin.type === 'io' || ref.pin.type === 'input'))
    const deviceRefs = refs.filter((ref) => !isMicrocontroller(ref.component) && isSignalPin(ref.pin))
    if (mcuRefs.length !== 1 || deviceRefs.length !== 1) continue
    const mcu = mcuRefs[0]
    const device = deviceRefs[0]
    if (device.pin.type === 'output' && mcu.pin.type !== 'output') {
      connections.push({ netName, mcu, device, direction: 'read' })
    } else if (device.pin.type === 'input' && mcu.pin.type === 'io') {
      connections.push({ netName, mcu, device, direction: 'drive' })
    }
  }
  return connections
}

/**
 * Derive `setup()` pin modes from the same connection model as `loop()`.
 * Legacy input/output-category parts keep their first pin configured, as before.
 */
function generateSetupBody(components: readonly Component[], wires: readonly Wire[], nets: readonly Net[], baud: number): string {
  const lines: string[] = [`  Serial.begin(${baud});`, '', '  // Initialize pins']
  const configured = new Set<string>()
  const configure = (pin: string, mode: 'INPUT' | 'OUTPUT'): void => {
    if (configured.has(pin)) return
    configured.add(pin)
    lines.push(`  pinMode(${pin}, ${mode});`)
  }

  for (const { mcu, direction } of boardConnections(groupPinsByNet(components, wires, nets))) {
    configure(mcu.pin.name, direction === 'read' ? 'INPUT' : 'OUTPUT')
  }
  for (const component of components) {
    if (component.category !== 'input' && component.category !== 'output') continue
    if (component.pins.length === 0) continue
    configure(component.pins[0].name, component.category === 'input' ? 'INPUT' : 'OUTPUT')
  }
  return lines.join('\n')
}

/**
 * Derive the `loop()` body from the schematic.
 *
 * The generated sketch reads sensors wired to an MCU pin and drives peripheral
 * inputs wired to one; named nets joining legacy input/output-category parts
 * mirror one onto the other. When nothing matches it emits a documented idle
 * loop rather than inventing behaviour the schematic does not describe.
 */
function generateLoopBody(components: readonly Component[], wires: readonly Wire[], nets: readonly Net[]): string {
  const netByPin = buildNetMap(wires, nets)
  const board = boardConnections(groupPinsByNet(components, wires, nets))
  const handledPins = new Set(board.map(({ device }) => `${device.component.id}${PIN_KEY}${device.pin.id}`))
  const lines: string[] = []
  const usedVariables = new Set<string>()
  const variableFor = (component: Component): string => {
    const base = `${sanitizeIdentifier(component.name || component.id, 'input')}Value`
    let candidate = base
    let suffix = 2
    while (usedVariables.has(candidate)) {
      candidate = `${base}${suffix}`
      suffix += 1
    }
    usedVariables.add(candidate)
    return candidate
  }

  for (const { netName, mcu, device, direction } of board) {
    if (direction === 'read') {
      const variable = variableFor(device.component)
      const read = isAnalogPinName(mcu.pin.name) ? 'analogRead' : 'digitalRead'
      lines.push(`  // ${device.component.name}.${device.pin.name} via ${mcu.component.name}.${mcu.pin.name} (net "${netName}")`)
      lines.push(`  int ${variable} = ${read}(${mcu.pin.name});`)
    } else {
      lines.push(`  // ${device.component.name}.${device.pin.name} via ${mcu.component.name}.${mcu.pin.name} (net "${netName}")`)
      if (/pwm/i.test(device.pin.name) || device.component.category === 'actuator') {
        lines.push(`  analogWrite(${mcu.pin.name}, 0); // 0..255: set the level this output needs`)
      } else {
        lines.push(`  digitalWrite(${mcu.pin.name}, LOW); // set HIGH to activate`)
      }
    }
  }

  const inputs = components.filter(
    (component) =>
      component.category === 'input' &&
      component.pins.length > 0 &&
      !handledPins.has(`${component.id}${PIN_KEY}${component.pins[0].id}`),
  )
  const outputs = components.filter(
    (component) =>
      component.category === 'output' &&
      component.pins.length > 0 &&
      !handledPins.has(`${component.id}${PIN_KEY}${component.pins[0].id}`),
  )
  for (const input of inputs) {
    const netName = netByPin.get(`${input.id}${PIN_KEY}${input.pins[0].id}`)
    const identifier = variableFor(input)
    lines.push(`  int ${identifier} = digitalRead(${input.pins[0].name});`)
    if (!netName) continue

    const linked = outputs.filter(
      (output) => netByPin.get(`${output.id}${PIN_KEY}${output.pins[0].id}`) === netName,
    )
    for (const output of linked) {
      lines.push(`  // ${input.name} and ${output.name} share net "${netName}"`)
      lines.push(`  digitalWrite(${output.pins[0].name}, ${identifier} ? HIGH : LOW);`)
    }
  }

  if (lines.length === 0) {
    lines.push('  // Nothing in this schematic maps onto a pin action, so this loop idles.')
    lines.push('  // Wire a sensor output or a peripheral input to a microcontroller pin to generate logic.')
  } else {
    lines.push('  delay(10); // 100 Hz loop: keeps the copy above from saturating the ADC and watchdog')
  }

  return lines.join('\n')
}

/* ────────────────────────────────────────────────────────────────────────────
 * Firmware image construction
 * ──────────────────────────────────────────────────────────────────────────── */

/** Load address AVR bootloaders use for an Arduino sketch image. */
export const AVR_APPLICATION_BASE_ADDRESS = 0

/**
 * Bytes of runtime the Arduino core contributes before the sketch's own code.
 * Used for a size *estimate*; it is a stated model, not a measurement.
 */
const CORE_OVERHEAD_BYTES = 512
/** Bytes of flash per source character, after -Os on AVR. */
const BYTES_PER_SOURCE_CHARACTER = 2.5
/** Fraction of the flash estimate that ends up in SRAM (globals plus stack). */
const RAM_FRACTION_OF_FLASH = 0.12

export interface FirmwareImage {
  hex: string
  binary: ArrayBuffer
  /** Bytes actually placed in the image. */
  imageBytes: number
  /** Base load address of the image. */
  baseAddress: number
}

/**
 * Build a **valid Intel HEX image containing the sketch source**.
 *
 * This is deliberately not presented as machine code: no vendor toolchain runs in
 * the browser, so producing AVR opcodes would be a fabrication. What is real is the
 * container — correct record framing, correct checksums, correct extended
 * addressing — which round-trips through any HEX parser and makes the generated
 * sketch retrievable from a programmed device.
 */
export function buildFirmwareImage(source: string, baseAddress = AVR_APPLICATION_BASE_ADDRESS): FirmwareImage {
  const bytes = textToBytes(source)
  const image = new Uint8Array(bytes.length + 1)
  image.set(bytes, 0)
  // NUL terminator, so the source can be recovered as a C string from the device.
  image[bytes.length] = 0

  const hex = bytesToIntelHex(image, { baseAddress })
  return { hex, binary: image.buffer.slice(0) as ArrayBuffer, imageBytes: image.length, baseAddress }
}

/** The caveat attached to every compilation result. */
export function describeImageCaveat(): string {
  return (
    'The HEX image contains this sketch’s source text inside a spec-correct Intel HEX container ' +
    '(verified checksums and extended addressing). No vendor toolchain is available in the browser, so ' +
    'the image is not AVR/XTENSA machine code and is not flashable as-is. Size figures are model ' +
    'estimates, not linker output. Attach arduino-cli (or a hosted builder) for a real binary.'
  )
}

/**
 * Load address for an ESP32 application image. Espressif's default partition
 * layout puts the factory app at 0x10000, which also exercises the encoder's
 * extended-address path.
 */
export const ESP32_APPLICATION_BASE_ADDRESS = 0x10000

export interface StaticAnalysis {
  errors: CompilationError[]
  warnings: CompilationWarning[]
  flashEstimate: number
  ramEstimate: number
}

/**
 * Static checks over the generated sketch.
 *
 * These are real checks with real failure modes — an unbalanced brace, an
 * unterminated string, a missing entry point — not a random "compilation
 * succeeded". Running a full C++ front end is out of scope, so what is checked
 * here is exactly what this function documents and nothing more.
 */
export function analyseSource(code: string, options: { requireSetupAndLoop: boolean }): StaticAnalysis {
  const errors: CompilationError[] = []
  const warnings: CompilationWarning[] = []

  const at = (offset: number) => {
    const before = code.slice(0, offset)
    return {
      line: before.split('\n').length,
      column: offset - (before.lastIndexOf('\n') + 1) + 1,
    }
  }

  // Bracket balance, ignoring string literals and block comments.
  const stack: Array<{ char: string; offset: number }> = []
  const closingToOpening: Record<string, string> = { '}': '{', ')': '(', ']': '[' }
  let inString = false
  let inComment = false
  let stringStart = 0

  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]
    const next = code[index + 1]

    if (inComment) {
      if (char === '*' && next === '/') {
        inComment = false
        index += 1
      }
      continue
    }
    if (inString) {
      if (char === '\\') index += 1
      else if (char === '"') inString = false
      continue
    }
    if (char === '/' && next === '*') {
      inComment = true
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      stringStart = index
      continue
    }
    if (char === '{' || char === '(' || char === '[') {
      stack.push({ char, offset: index })
      continue
    }
    if (char === '}' || char === ')' || char === ']') {
      const open = stack.pop()
      if (!open || open.char !== closingToOpening[char]) {
        errors.push({ ...at(index), message: `Unmatched '${char}'`, severity: 'error' })
      }
    }
  }

  if (inString) {
    errors.push({ ...at(stringStart), message: 'Unterminated string literal', severity: 'error' })
  }
  for (const open of stack) {
    errors.push({ ...at(open.offset), message: `Unclosed '${open.char}'`, severity: 'error' })
  }

  if (code.includes('<<<<<<<') || code.includes('>>>>>>>')) {
    errors.push({ line: 1, column: 1, message: 'Unresolved merge conflict markers', severity: 'error' })
  }

  if (options.requireSetupAndLoop) {
    if (!/\bvoid\s+setup\s*\(/.test(code)) {
      errors.push({ line: 1, column: 1, message: 'Missing setup() entry point', severity: 'error' })
    }
    if (!/\bvoid\s+loop\s*\(/.test(code)) {
      errors.push({ line: 1, column: 1, message: 'Missing loop() entry point', severity: 'error' })
    }
  }

  // eslint-disable-next-line no-control-regex
  const nonAscii = /[^\x00-\x7F]/.exec(code)
  if (nonAscii) {
    warnings.push({
      ...at(nonAscii.index),
      message: `Non-ASCII character "${nonAscii[0]}" in generated code; some toolchains reject it`,
      severity: 'warning',
    })
  }

  if (errors.length === 0 && !/\bdelay\s*\(|\bmillis\s*\(|\bmicros\s*\(/.test(code)) {
    warnings.push({
      line: 1,
      column: 1,
      message: 'loop() has no timing call, so it will run as fast as the CPU allows',
      severity: 'info',
    })
  }

  return {
    errors,
    warnings,
    flashEstimate: Math.round(code.length * BYTES_PER_SOURCE_CHARACTER) + CORE_OVERHEAD_BYTES,
    ramEstimate: Math.round(code.length * BYTES_PER_SOURCE_CHARACTER * RAM_FRACTION_OF_FLASH),
  }
}

/**
 * Build a sketch for a board family from the schematic's netlist.
 *
 * Shared by both targets so AVR and ESP32 output can never drift apart: the
 * only differences are the platform comment, baud rate and extra includes.
 */
function generateSketch(
  platform: 'Arduino' | 'ESP32',
  baud: number,
  extraIncludes: readonly string[],
  components: Component[],
  wires: Wire[],
  nets: Net[],
  options: CompilerOptions,
): string {
  validateCompilerOptions(options)

  let code = `// ${platform} sketch from schematic (optimization: ${options.optimization}, debug: ${options.debug ? 'on' : 'off'})\n`
  code += '#include <Arduino.h>\n'
  for (const include of extraIncludes) code += `#include <${include}>\n`
  for (const library of options.libraries) code += `#include <${library}.h>\n`
  for (const include of options.includes) {
    code += `#include <${include.replace(/^<|>$/g, '')}>\n`
  }
  code += '\n'

  const defines = Object.entries(options.defines)
  for (const [key, value] of defines) code += `#define ${key} ${value}\n`
  if (defines.length > 0) code += '\n'

  code += generatePinMappings(platform, components, wires, nets)
  code += '\n'
  code += `void setup() {\n${generateSetupBody(components, wires, nets, baud)}\n}\n\n`
  code += `void loop() {\n${generateLoopBody(components, wires, nets)}\n}\n`
  return code
}

/** Analyse a generated sketch and package it as an Intel HEX image. */
function packageSketch(code: string, baseAddress: number, target: string, version: string): CompilationResult {
  const analysis = analyseSource(code, { requireSetupAndLoop: true })
  const image = buildFirmwareImage(code, baseAddress)

  return {
    success: analysis.errors.length === 0,
    output:
      analysis.errors.length === 0
        ? `Analysed ${code.length} characters. Firmware image: ${image.imageBytes} bytes at 0x${image.baseAddress
            .toString(16)
            .padStart(4, '0')
            .toUpperCase()}.`
        : `Analysis failed with ${analysis.errors.length} error(s).`,
    code,
    errors: analysis.errors,
    warnings: [
      ...analysis.warnings,
      { line: 0, column: 0, message: describeImageCaveat(), severity: 'info' },
    ],
    binary: image.binary,
    hex: image.hex,
    size: { flash: analysis.flashEstimate, ram: analysis.ramEstimate },
    metadata: { compilationTime: 0, target, version },
  }
}

// Arduino Compiler Target
export class ArduinoCompiler implements CompilerTarget {
  id = 'arduino';
  name = 'Arduino Compiler';
  description = 'Compile for Arduino boards using AVR-GCC';
  supportedBoards = ['arduino_uno', 'arduino_nano', 'arduino_mega'];

  async compile(components: Component[], wires: Wire[], nets: Net[], options: CompilerOptions): Promise<CompilationResult> {
    const startTime = Date.now();

    try {
      // Generate Arduino C++ code from schematic
      const code = this.generateArduinoCode(components, wires, nets, options);

      // Analyse the sketch and package it as a HEX image (no fake delay/timings).
      const result = this.compileSource(code);

      return {
        ...result,
        metadata: {
          compilationTime: Date.now() - startTime,
          target: this.id,
          version: '1.8.19'
        }
      };
    } catch (error) {
      return {
        success: false,
        output: 'Compilation failed',
        code: '',
        errors: [{
          line: 0,
          column: 0,
          message: error instanceof Error ? error.message : 'Unknown compilation error',
          severity: 'fatal'
        }],
        warnings: [],
        size: { flash: 0, ram: 0 },
        metadata: {
          compilationTime: Date.now() - startTime,
          target: this.id,
          version: '1.8.19'
        }
      };
    }
  }

  private generateArduinoCode(components: Component[], wires: Wire[], nets: Net[], options: CompilerOptions): string {
    return generateSketch('Arduino', 9600, [], components, wires, nets, options)
  }

  /**
   * Analyse and package the generated sketch.
   *
   * No artificial delay: the previous implementation slept for a random 1–3 s to
   * *look* like a compiler. The work here is genuinely synchronous (a static pass
   * plus a HEX encode), so the reported time is the real elapsed time.
   */
  private compileSource(code: string): CompilationResult {
    return packageSketch(code, AVR_APPLICATION_BASE_ADDRESS, 'arduino', '1.8.19')
  }
}

// ESP32 Compiler Target
export class ESP32Compiler implements CompilerTarget {
  id = 'esp32';
  name = 'ESP32 Compiler';
  description = 'Compile for ESP32 boards using ESP-IDF';
  supportedBoards = ['esp32_dev', 'esp32_wroom', 'esp32_s2', 'esp32_s3', 'esp32_c3'];

  async compile(components: Component[], wires: Wire[], nets: Net[], options: CompilerOptions): Promise<CompilationResult> {
    const startTime = Date.now();

    try {
      const code = this.generateESP32Code(components, wires, nets, options);
      const result = this.compileSource(code, ESP32_APPLICATION_BASE_ADDRESS);

      return {
        ...result,
        metadata: {
          compilationTime: Date.now() - startTime,
          target: this.id,
          version: '4.4.1'
        }
      };
    } catch (error) {
      return {
        success: false,
        output: 'Compilation failed',
        code: '',
        errors: [{
          line: 0,
          column: 0,
          message: error instanceof Error ? error.message : 'Unknown compilation error',
          severity: 'fatal'
        }],
        warnings: [],
        size: { flash: 0, ram: 0 },
        metadata: {
          compilationTime: Date.now() - startTime,
          target: this.id,
          version: '4.4.1'
        }
      };
    }
  }

  private generateESP32Code(components: Component[], wires: Wire[], nets: Net[], options: CompilerOptions): string {
    return generateSketch('ESP32', 115200, ['WiFi.h'], components, wires, nets, options)
  }

  /**
   * Analyse and package the generated ESP32 sketch.
   *
   * Same honesty contract as the AVR path: real static checks plus a
   * spec-correct HEX container, with no fabricated timings or binary blobs.
   */
  private compileSource(code: string, baseAddress: number): CompilationResult {
    return packageSketch(code, baseAddress, 'esp32', '4.4.1')
  }
}

// Compiler Manager
export class CompilerManager {
  private targets: Map<string, CompilerTarget> = new Map();

  constructor() {
    this.registerTarget(new ArduinoCompiler());
    this.registerTarget(new ESP32Compiler());
  }

  registerTarget(target: CompilerTarget): void {
    this.targets.set(target.id, target);
  }

  getTarget(id: string): CompilerTarget | undefined {
    return this.targets.get(id);
  }

  getAllTargets(): CompilerTarget[] {
    return Array.from(this.targets.values());
  }

  getTargetsForBoard(boardId: string): CompilerTarget[] {
    return this.getAllTargets().filter(target =>
      target.supportedBoards.includes(boardId)
    );
  }

  async compile(components: Component[], wires: Wire[], nets: Net[], options: CompilerOptions): Promise<CompilationResult> {
    const target = this.getTarget(options.target);
    if (!target) {
      throw new Error(`Unknown compiler target: ${options.target}`);
    }

    return target.compile(components, wires, nets, options);
  }
}

export const compilerManager = new CompilerManager();