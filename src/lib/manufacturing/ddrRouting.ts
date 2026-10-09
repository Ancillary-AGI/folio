/**
 * DDR routing rules (Pi-class leg 7).
 * DDR3/4 on a Pi-class board: DQS groups with DQ-to-strobe match, fly-by
 * address/command/clock topology, write-levelling window. Lengths in mm,
 * skew in ps at 6 ps/mm.
 */
export interface DqsGroup {
  name: string
  strobeLength: number
  dqLengths: number[]
  /** Per-bit match window to strobe, mm. */
  windowMm: number
}

export interface DqsViolation {
  group: string
  bit: number
  mismatchMm: number
  message: string
}

/** Every DQ inside the window around its strobe, or violations per bit. */
export function checkDqsGroup(group: DqsGroup): { skewPs: number[]; violations: DqsViolation[] } {
  const violations: DqsViolation[] = []
  const skewPs: number[] = []
  group.dqLengths.forEach((length, bit) => {
    const mismatch = length - group.strobeLength
    skewPs.push(mismatch * 6)
    if (Math.abs(mismatch) > group.windowMm) {
      violations.push({ group: group.name, bit, mismatchMm: mismatch, message: `${group.name} DQ${bit}: ${mismatch.toFixed(2)} mm off strobe, window ${group.windowMm} mm.` })
    }
  })
  return { skewPs, violations }
}

export interface FlybyChain {
  clockLength: number
  addrLengths: number[]
  /** Address must track clock inside this window, mm. */
  windowMm: number
}

/** Fly-by: each ADDR/CMD within the window of CLOCK at its load. */
export function checkFlyby(chain: FlybyChain): string[] {
  const violations: string[] = []
  chain.addrLengths.forEach((length, index) => {
    if (Math.abs(length - chain.clockLength) > chain.windowMm) {
      violations.push(`ADDR${index}: ${(length - chain.clockLength).toFixed(2)} mm off CLOCK, window ${chain.windowMm} mm.`)
    }
  })
  return violations
}

/** DDR3-1600 reference windows: ±0.5 mm DQ-to-DQS, ±1 mm ADDR-to-CLOCK. */
export const DDR3_1600 = { dqWindowMm: 0.5, flybyWindowMm: 1.0 }
