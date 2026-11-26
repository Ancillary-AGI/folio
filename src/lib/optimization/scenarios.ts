/**
 * Scenarios a coupled study can run.
 *
 * Here rather than beside the agent tool so the UI does not import agent
 * internals to find out what it can ask for.
 */
export const COUPLED_SCENARIOS = ['conductor', 'heatsink', 'beam'] as const

export type CoupledScenario = (typeof COUPLED_SCENARIOS)[number]

export const isCoupledScenario = (value: string): value is CoupledScenario =>
  (COUPLED_SCENARIOS as readonly string[]).includes(value)

/** The label shown wherever a scenario is offered. */
export const COUPLED_SCENARIO_LABELS: Readonly<Record<CoupledScenario, string>> = {
  conductor: 'Conductor — electrical, thermal and stiffness',
  heatsink: 'Heatsink — thermal, mass and cost',
  beam: 'Beam — structural load and thermal stress',
}