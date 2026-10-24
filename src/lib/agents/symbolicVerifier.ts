/**
 * Symbolic Verification Engine for AI Agents.
 * AI models must NEVER hallucinate circuit connections, short power rails,
 * or violate physical design rules. This engine acts as a deterministic ground-truth
 * verifier: electrical rule checks (ERC), power rail separation, bus contention,
 * and boolean equivalence verification.
 */

export interface CircuitNode {
  id: string;
  pins: Array<{ componentId: string; pinId: string; pinKind: 'power' | 'ground' | 'input' | 'output' | 'bidirectional' | 'passive'; voltageV?: number }>;
  netName?: string;
}

export interface VerificationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  components: string[];
  net?: string;
}

export interface SymbolicVerificationResult {
  passed: boolean;
  errors: VerificationIssue[];
  warnings: VerificationIssue[];
  metrics: {
    nodeCount: number;
    pinCount: number;
    powerNets: string[];
    groundNets: string[];
  };
}

/**
 * Deterministically check a circuit netlist for electrical rule violations.
 */
export function verifyCircuitTopology(nodes: CircuitNode[]): SymbolicVerificationResult {
  const errors: VerificationIssue[] = [];
  const warnings: VerificationIssue[] = [];
  const powerNets = new Set<string>();
  const groundNets = new Set<string>();
  let totalPins = 0;

  for (const node of nodes) {
    totalPins += node.pins.length;
    const netName = node.netName?.toUpperCase() ?? '';

    // Track power and ground designations
    const isPower = netName.includes('VCC') || netName.includes('VDD') || netName.includes('3V3') || netName.includes('5V') || netName.includes('+');
    const isGround = netName.includes('GND') || netName.includes('VSS') || netName.includes('0V') || netName === '-';

    if (isPower) powerNets.add(node.netName!);
    if (isGround) groundNets.add(node.netName!);

    // 1. Power-Ground Short Circuit Check
    if (isPower && isGround) {
      errors.push({
        severity: 'error',
        code: 'ERC_POWER_GROUND_SHORT',
        message: `Catastrophic short circuit: Node "${node.netName}" contains both power and ground designations.`,
        components: node.pins.map((p) => p.componentId),
        net: node.netName,
      });
    }

    // 2. Bus Contention: Multiple active outputs driving the same node
    const outputPins = node.pins.filter((p) => p.pinKind === 'output');
    if (outputPins.length > 1) {
      errors.push({
        severity: 'error',
        code: 'ERC_BUS_CONTENTION',
        message: `Bus contention: Node "${node.netName ?? node.id}" is driven by ${outputPins.length} push-pull outputs simultaneously.`,
        components: outputPins.map((p) => p.componentId),
        net: node.netName,
      });
    }

    // 3. Floating High-Impedance Inputs. A passive pin is a valid DC path
    // (pull-up/down/series resistor), so it counts as a driver here — flagging
    // an input tied through a resistor as floating was a false positive.
    const inputPins = node.pins.filter((p) => p.pinKind === 'input');
    const driverPins = node.pins.filter((p) => p.pinKind !== 'input');
    if (inputPins.length > 0 && driverPins.length === 0) {
      warnings.push({
        severity: 'warning',
        code: 'ERC_FLOATING_INPUT',
        message: `Floating input: Node "${node.netName ?? node.id}" has ${inputPins.length} input pins without an active driver or pull-up/down.`,
        components: inputPins.map((p) => p.componentId),
        net: node.netName,
      });
    }

    // 4. Single-pin Net (Unconnected node)
    if (node.pins.length === 1 && !isPower && !isGround) {
      warnings.push({
        severity: 'warning',
        code: 'ERC_UNCONNECTED_PIN',
        message: `Unconnected terminal: Pin ${node.pins[0].pinId} on component ${node.pins[0].componentId} is unconnected.`,
        components: [node.pins[0].componentId],
        net: node.netName,
      });
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    metrics: {
      nodeCount: nodes.length,
      pinCount: totalPins,
      powerNets: [...powerNets],
      groundNets: [...groundNets],
    },
  };
}

/**
 * Symbolic Boolean Equivalence Checker.
 * Evaluates truth tables of two boolean expressions across all input combinations
 * to formally prove that a synthesized or modified logic circuit matches the golden spec.
 */
export function verifyBooleanEquivalence(
  exprA: (inputs: Record<string, boolean>) => boolean,
  exprB: (inputs: Record<string, boolean>) => boolean,
  variables: string[],
): { equivalent: boolean; counterExample?: Record<string, boolean> } {
  if (variables.length === 0) throw new Error('At least one variable is required.');
  const totalCombinations = 1 << variables.length;

  for (let i = 0; i < totalCombinations; i += 1) {
    const inputState: Record<string, boolean> = {};
    for (let bit = 0; bit < variables.length; bit += 1) {
      inputState[variables[bit]] = Boolean((i >> bit) & 1);
    }

    const resA = exprA(inputState);
    const resB = exprB(inputState);

    if (resA !== resB) {
      return {
        equivalent: false,
        counterExample: inputState,
      };
    }
  }

  return { equivalent: true };
}
