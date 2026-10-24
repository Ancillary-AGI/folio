/**
 * Discrete-event digital logic simulator.
 *
 * The SPICE engine beside it is continuous-time: modified nodal analysis over
 * resistors, transistors, capacitors. That is the wrong model for logic. A
 * NAND gate is not a set of differential equations — it is a Boolean function
 * that changes its output a fixed delay after its inputs settle. This module
 * models logic the way real simulators (Verilator, Icarus, ngspice's event
 * layer) do, with three things that make it trustworthy rather than a toy:
 *
 *   1. Four-state logic — 0, 1, X (unknown) and Z (high-impedance), not two
 *      booleans. X is the honest answer when a value is not yet known, and it
 *      propagates: an AND with one X input and no 0 input is X, never a guess.
 *   2. Propagation delay — a gate's output lands `delay` time units after its
 *      input changes. The delay is inertial: an input pulse shorter than the
 *      delay is swallowed, and a later input change withdraws the transition
 *      that was still in flight. Without delay you cannot measure timing, build
 *      a ring oscillator, or catch a race; with it the waveform is a real timing
 *      diagram.
 *   3. Edge-triggered state — flip-flops sample their data inputs only on the
 *      configured clock edge and update after their own delay, so sequential
 *      circuits (counters, registers, state machines) behave as hardware does.
 *      Events at the same timestamp run in insertion order, and clock edges are
 *      seeded before stimuli, so a data/clock race resolves deterministically
 *      rather than randomly — a documented convention, not a hardware race
 *      model.
 *
 * Nothing here invents a result. An unmodelled construct, a combinational loop
 * that will not settle, or a runaway event storm returns `success: false` with
 * an explanation — the same fail-loud contract as the analog solver.
 */

export type LogicValue = 0 | 1 | 'X' | 'Z'

export type GateType = 'NOT' | 'BUF' | 'AND' | 'NAND' | 'OR' | 'NOR' | 'XOR' | 'XNOR'
export type FlipFlopType = 'SR' | 'D' | 'JK' | 'T'

export interface Gate {
  id: string
  type: GateType
  inputs: string[]
  output: string
  /** Propagation delay in simulation time units. */
  delay: number
}

export interface FlipFlop {
  id: string
  type: FlipFlopType
  /** Node driving the clock input. */
  clock: string
  edge: 'rising' | 'falling'
  delay: number
  /** Data inputs keyed by role, e.g. `{ D: 'd' }` or `{ J: 'j', K: 'k' }`. */
  inputs: Record<string, string>
  /** Node names for the Q and Q-bar outputs. */
  q: string
  qbar: string
}

export interface Clock {
  id: string
  output: string
  period: number
  /** Duty cycle in (0,1); default 0.5. A duty of 1 would have no low phase. */
  duty?: number
  startState?: 0 | 1
}

export interface Stimulus {
  node: string
  time: number
  value: LogicValue
}

export interface DigitalNetlist {
  gates: Gate[]
  flipFlops?: FlipFlop[]
  clocks?: Clock[]
  stimuli?: Stimulus[]
  /** Initial node values before t=0; anything unset starts as X. */
  initialValues?: Record<string, LogicValue>
}

export interface LogicTransition {
  time: number
  value: LogicValue
}

export interface DigitalResult {
  success: boolean
  error?: string
  /** Exact per-node transition history, for asserting against a reference. */
  transitions: Record<string, LogicTransition[]>
  nodeValues: string[]
  eventCount: number
  finalValues: Record<string, LogicValue>
  notes?: string[]
}

/* ------------------------------------------------------------------ */
/* Four-state logic primitives                                         */
/* ------------------------------------------------------------------ */

export function notLogic(value: LogicValue): LogicValue {
  return value === 0 ? 1 : value === 1 ? 0 : 'X'
}

/** Evaluate one gate over its resolved inputs. Pure and total. */
export function evalGate(type: GateType, inputs: LogicValue[]): LogicValue {
  if (inputs.length === 0) return 'X'
  const unknown = inputs.some((value) => value === 'X' || value === 'Z')
  switch (type) {
    case 'NOT':
      return notLogic(inputs[0] === 'Z' ? 'X' : inputs[0])
    case 'BUF':
      return inputs[0] === 'Z' ? 'X' : inputs[0]
    case 'AND':
    case 'NAND': {
      const result: LogicValue = inputs.some((v) => v === 0) ? 0 : unknown ? 'X' : 1
      return type === 'NAND' ? notLogic(result) : result
    }
    case 'OR':
    case 'NOR': {
      const result: LogicValue = inputs.some((v) => v === 1) ? 1 : unknown ? 'X' : 0
      return type === 'NOR' ? notLogic(result) : result
    }
    case 'XOR':
    case 'XNOR': {
      if (unknown) return 'X'
      const ones = inputs.filter((v) => v === 1).length
      const result: LogicValue = (ones % 2) as 0 | 1
      return type === 'XNOR' ? notLogic(result) : result
    }
    default:
      return 'X'
  }
}

/** Compute a flip-flop's next (q, qbar) from its sampled inputs and current q. */
export function flipFlopNextState(
  type: FlipFlopType,
  inputs: Record<string, LogicValue>,
  currentQ: LogicValue,
): { q: LogicValue; qbar: LogicValue } {
  const currentQbar = notLogic(currentQ)
  switch (type) {
    case 'D': {
      const d = inputs.D ?? 'X'
      const q = d === 'Z' ? currentQ : d
      return { q, qbar: notLogic(q) }
    }
    case 'T': {
      const t = inputs.T ?? 'X'
      if (t === 0) return { q: currentQ, qbar: currentQbar }
      if (t === 1) return { q: currentQbar, qbar: currentQ }
      return { q: 'X', qbar: 'X' }
    }
    case 'JK': {
      const j = inputs.J ?? 'X'
      const k = inputs.K ?? 'X'
      if (j === 1 && k === 0) return { q: 1, qbar: 0 }
      if (j === 0 && k === 1) return { q: 0, qbar: 1 }
      if (j === 0 && k === 0) return { q: currentQ, qbar: currentQbar } // hold
      if (j === 1 && k === 1) return { q: currentQbar, qbar: currentQ } // toggle
      // Any X/Z input leaves the next state unknown instead of guessing a set,
      // reset or toggle that the circuit cannot guarantee.
      return { q: 'X', qbar: 'X' }
    }
    case 'SR': {
      const s = inputs.S ?? 'X'
      const r = inputs.R ?? 'X'
      if (s === 1 && r === 0) return { q: 1, qbar: 0 }
      if (s === 0 && r === 1) return { q: 0, qbar: 1 }
      if (s === 0 && r === 0) return { q: currentQ, qbar: currentQbar }
      // Both asserted is invalid, and any unknown input could resolve either
      // way: both are X, never a hold guess.
      return { q: 'X', qbar: 'X' }
    }
    default:
      return { q: 'X', qbar: 'X' }
  }
}

/* ------------------------------------------------------------------ */
/* Event queue — binary min-heap on (time, insertion order)           */
/* ------------------------------------------------------------------ */

interface ScheduledEvent {
  time: number
  seq: number
  node: string
  value: LogicValue
  /** Gate that produced this output transition, for inertial cancellation. */
  gate?: Gate
}

class EventQueue {
  private heap: ScheduledEvent[] = []

  get size(): number {
    return this.heap.length
  }

  push(event: ScheduledEvent): void {
    this.heap.push(event)
    let index = this.heap.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.less(index, parent)) {
        this.swap(index, parent)
        index = parent
      } else break
    }
  }

  pop(): ScheduledEvent | undefined {
    if (this.heap.length === 0) return undefined
    const top = this.heap[0]
    const last = this.heap.pop()!
    if (this.heap.length > 0) {
      this.heap[0] = last
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (left < this.heap.length && this.less(left, smallest)) smallest = left
        if (right < this.heap.length && this.less(right, smallest)) smallest = right
        if (smallest === index) break
        this.swap(index, smallest)
        index = smallest
      }
    }
    return top
  }

  private less(a: number, b: number): boolean {
    const ea = this.heap[a]
    const eb = this.heap[b]
    return ea.time < eb.time || (ea.time === eb.time && ea.seq < eb.seq)
  }

  private swap(a: number, b: number): void {
    const tmp = this.heap[a]
    this.heap[a] = this.heap[b]
    this.heap[b] = tmp
  }
}

/* ------------------------------------------------------------------ */
/* Simulator                                                           */
/* ------------------------------------------------------------------ */

const MAX_EVENTS = 5_000_000

export function simulateDigital(netlist: DigitalNetlist, stopTime: number): DigitalResult {
  const gates = netlist.gates
  const flipFlops = netlist.flipFlops ?? []
  const clocks = netlist.clocks ?? []

  // Every node that appears anywhere, so unknown nets are visible, not absent.
  const nodeNames = new Set<string>(Object.keys(netlist.initialValues ?? {}))
  for (const gate of gates) {
    nodeNames.add(gate.output)
    gate.inputs.forEach((node) => nodeNames.add(node))
  }
  for (const ff of flipFlops) {
    nodeNames.add(ff.clock)
    nodeNames.add(ff.q)
    nodeNames.add(ff.qbar)
    Object.values(ff.inputs).forEach((node) => nodeNames.add(node))
  }
  for (const clock of clocks) nodeNames.add(clock.output)
  for (const stimulus of netlist.stimuli ?? []) nodeNames.add(stimulus.node)

  // Current value of each node, and its full transition history.
  const values = new Map<string, LogicValue>()
  const transitions: Record<string, LogicTransition[]> = {}
  for (const node of nodeNames) {
    const initial = netlist.initialValues?.[node] ?? 'X'
    values.set(node, initial)
    transitions[node] = [{ time: 0, value: initial }]
  }

  const fail = (error: string): DigitalResult => ({
    success: false,
    error,
    transitions,
    nodeValues: [...nodeNames],
    eventCount: 0,
    finalValues: Object.fromEntries(values),
  })

  // Validate every spec before scheduling. A malformed delay or timestamp would
  // otherwise schedule events in the past, stall the clock loop, or silently
  // drop timing information.
  if (!Number.isFinite(stopTime) || stopTime <= 0) {
    return fail('stopTime must be a finite value > 0')
  }
  for (const gate of gates) {
    if (!Number.isFinite(gate.delay) || gate.delay < 0) {
      return fail(`gate ${gate.id} has a non-finite or negative delay`)
    }
    if (gate.inputs.length === 0) {
      return fail(`gate ${gate.id} has no inputs`)
    }
    if ((gate.type === 'NOT' || gate.type === 'BUF') && gate.inputs.length !== 1) {
      return fail(`gate ${gate.id} is ${gate.type} and must have exactly one input`)
    }
  }
  for (const ff of flipFlops) {
    if (!Number.isFinite(ff.delay) || ff.delay < 0) {
      return fail(`flip-flop ${ff.id} has a non-finite or negative delay`)
    }
  }
  for (const stimulus of netlist.stimuli ?? []) {
    if (!Number.isFinite(stimulus.time) || stimulus.time < 0) {
      return fail(`stimulus on node "${stimulus.node}" has a non-finite or negative time`)
    }
  }

  // Fan-out: which gates read a node, which flip-flops clock off it.
  const gateFanout = new Map<string, Gate[]>()
  for (const gate of gates) {
    for (const input of gate.inputs) {
      const list = gateFanout.get(input) ?? []
      list.push(gate)
      gateFanout.set(input, list)
    }
  }
  const ffByClock = new Map<string, FlipFlop[]>()
  for (const ff of flipFlops) {
    const list = ffByClock.get(ff.clock) ?? []
    list.push(ff)
    ffByClock.set(ff.clock, list)
  }

  const queue = new EventQueue()
  let seq = 0
  /** Latest scheduled transition per gate: earlier ones are superseded. */
  const pendingGateEvent = new Map<Gate, number>()
  const schedule = (time: number, node: string, value: LogicValue, gate?: Gate): number => {
    const eventSeq = seq++
    queue.push({ time, seq: eventSeq, node, value, gate })
    return eventSeq
  }

  // Seed clock edges and stimuli. Validate clocks up front so a bad spec fails
  // loud instead of silently producing a flat or infinite clock.
  for (const clock of clocks) {
    if (!Number.isFinite(clock.period) || clock.period <= 0) {
      return fail(`clock ${clock.id} has a non-positive or non-finite period`)
    }
    const duty = clock.duty ?? 0.5
    if (!Number.isFinite(duty) || duty <= 0 || duty >= 1) {
      return fail(`clock ${clock.id} duty must be in (0,1)`)
    }
    const highTime = clock.period * duty
    const lowTime = clock.period - highTime
    // A duty so close to 1 that floats round the low phase to zero would make
    // the loop below stop advancing.
    if (!(highTime > 0) || !(lowTime > 0)) {
      return fail(`clock ${clock.id} period and duty leave a zero-length phase`)
    }
    if (Math.ceil(stopTime / Math.min(highTime, lowTime)) + 1 > MAX_EVENTS) {
      return fail(`clock ${clock.id} would schedule more than ${MAX_EVENTS} edges — shorten stopTime or lengthen the period`)
    }
    let state = clock.startState ?? 0
    for (let t = 0; t <= stopTime + 1e-9; ) {
      schedule(t, clock.output, state)
      state = state === 0 ? 1 : 0
      t += state === 0 ? highTime : lowTime
    }
  }
  for (const stimulus of netlist.stimuli ?? []) {
    schedule(stimulus.time, stimulus.node, stimulus.value)
  }

  let eventCount = 0
  for (;;) {
    const event = queue.pop()
    if (!event || event.time > stopTime + 1e-9) break
    if (++eventCount > MAX_EVENTS) {
      return {
        success: false,
        error: `event budget exceeded (${MAX_EVENTS}) — a combinational loop will not settle`,
        transitions,
        nodeValues: [...nodeNames],
        eventCount,
        finalValues: Object.fromEntries(values),
      }
    }

    const previous = values.get(event.node) ?? 'X'
    if (event.gate) {
      /*
       * Inertial delay: a transition superseded by a later input change never
       * happened in hardware. Without this check a stale event would fire and
       * drive the output to a value the inputs had already abandoned.
       */
      if (pendingGateEvent.get(event.gate) !== event.seq) continue
      pendingGateEvent.delete(event.gate)
    }
    if (previous === event.value) continue // no transition, nothing propagates
    values.set(event.node, event.value)
    transitions[event.node].push({ time: event.time, value: event.value })

    // Edge-triggered flip-flops clocked by this node.
    for (const ff of ffByClock.get(event.node) ?? []) {
      const isRising = previous === 0 && event.value === 1
      const isFalling = previous === 1 && event.value === 0
      const fired = ff.edge === 'rising' ? isRising : isFalling
      if (!fired) continue
      const sampled: Record<string, LogicValue> = {}
      for (const [role, node] of Object.entries(ff.inputs)) {
        sampled[role] = values.get(node) ?? 'X'
      }
      const next = flipFlopNextState(ff.type, sampled, values.get(ff.q) ?? 'X')
      schedule(event.time + ff.delay, ff.q, next.q)
      schedule(event.time + ff.delay, ff.qbar, next.qbar)
    }

    // Combinational gates that read this node.
    for (const gate of gateFanout.get(event.node) ?? []) {
      const inputs = gate.inputs.map((node) => values.get(node) ?? 'X')
      const output = evalGate(gate.type, inputs)
      if (output !== (values.get(gate.output) ?? 'X')) {
        pendingGateEvent.set(gate, schedule(event.time + gate.delay, gate.output, output, gate))
      } else if (pendingGateEvent.has(gate)) {
        // The inputs returned to the value the output already holds, so the
        // in-flight transition must be withdrawn (inertial delay).
        pendingGateEvent.delete(gate)
      }
    }
  }

  return {
    success: true,
    transitions,
    nodeValues: [...nodeNames],
    eventCount,
    finalValues: Object.fromEntries(values),
  }
}

/** Last value a node held at or before `time`; X if it never settled. */
export function valueAt(result: DigitalResult, node: string, time: number): LogicValue {
  const history = result.transitions[node]
  if (!history || history.length === 0) return 'X'
  let low = 0
  let high = history.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (history[middle].time <= time + 1e-9) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found >= 0 ? history[found].value : 'X'
}
