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
 * Net-name classification, by token rather than by substring.
 *
 * Substring matching was wrong in both directions: `10V` and `20V` contain
 * `0V`, so a real 10 V rail was classified as ground and a genuine
 * power-to-ground short on it went unreported; and `VCC+` versus a passive
 * node named `IN+` both contain `+`, so ordinary signal nets were declared
 * power rails. A rail is a name that *is* a voltage or a supply token, not one
 * that merely contains those characters.
 */
const GROUND_PATTERN = /^(?:GND|GROUND|EARTH|CHASSIS|COM|RTN|RETURN|VSS|VSSA|AGND|DGND|PGND|0V?|-)$/
/** A literal rail voltage: `5`, `5V`, `3V3`, `+3V3`, `-12V`, `1V8`. */
const RAIL_PATTERN = /^[+-]?\d+(?:\.\d+)?V\d*(?:[MUK])?A?$/
/** A named supply: `VCC`, `VDDIO`, `AVDD`, `VBUS`, `VCC3V3`, `+5V`. */
const SUPPLY_PATTERN = /^(?:\+)?(?:VCC|VDD|VBUS|VBAT|VIN|VOUT|VREF|AVDD|DVDD|AVCC|DVCC|VDDIO|VCCIO|PWR|POWER|POS)(?:\d.*|IO|DD|IN|OUT)?$/

const isGroundName = (netName: string): boolean => GROUND_PATTERN.test(netName)
const isPowerName = (netName: string): boolean =>
  !isGroundName(netName) && (RAIL_PATTERN.test(netName) || SUPPLY_PATTERN.test(netName))

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

    /* A node's role comes from two independent sources. The net name says what
     * the designer called it; the pin kinds say what the parts declare. Either
     * is enough to mark the node, because a power pin wired to a net named GND
     * is exactly the short this check exists to catch — and a rail named `10V`
     * must not be read as ground merely because `0V` occurs inside it. */
    const nameIsPower = isPowerName(netName);
    const nameIsGround = isGroundName(netName);
    const pinSaysPower = node.pins.some((pin) => pin.pinKind === 'power');
    const pinSaysGround = node.pins.some((pin) => pin.pinKind === 'ground');
    const isPower = nameIsPower || pinSaysPower;
    const isGround = nameIsGround || pinSaysGround;

    if (nameIsPower || pinSaysPower) powerNets.add(node.netName!);
    if (nameIsGround || pinSaysGround) groundNets.add(node.netName!);

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
/** Beyond this many variables a truth table is not a verification method. */
export const MAX_TRUTH_TABLE_VARIABLES = 20;

export function verifyBooleanEquivalence(
  exprA: (inputs: Record<string, boolean>) => boolean,
  exprB: (inputs: Record<string, boolean>) => boolean,
  variables: string[],
): { equivalent: boolean; counterExample?: Record<string, boolean> } {
  if (variables.length === 0) throw new Error('At least one variable is required.');
  if (variables.length > MAX_TRUTH_TABLE_VARIABLES) {
    throw new Error(
      `Boolean equivalence over ${variables.length} variables needs 2^${variables.length} evaluations; ` +
        `the limit is ${MAX_TRUTH_TABLE_VARIABLES}. Verify these with a SAT solver instead.`,
    );
  }
  // `1 << n` overflows to a negative number at 31 variables, which made the
  // loop below never run and reported `equivalent: true` without checking
  // anything — the worst possible failure for a verifier.
  const totalCombinations = 2 ** variables.length;

  for (let i = 0; i < totalCombinations; i += 1) {
    const inputState: Record<string, boolean> = {};
    for (let bit = 0; bit < variables.length; bit += 1) {
      inputState[variables[bit]] = Math.floor(i / 2 ** bit) % 2 === 1;
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
