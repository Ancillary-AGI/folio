/**
 * The scenarios a coupled cross-domain study can run.
 *
 * Lives here rather than beside the agent tool because two callers need the
 * list: the tool that dispatches on it, and the panel that offers it. Keeping it
 * in the optimization layer means the UI does not have to import agent internals
 * to know what it can ask for.
 *
 * Each scenario is a genuine cross-domain study, not a relabelled
 * single-discipline calculation:
 *
 *   - `conductor` couples electrical, thermal and mechanical through one section.
 *   - `heatsink` couples thermal, mechanical and cost through fin efficiency,
 *     which depends on the fin thickness that also sets mass and price.
 *   - `beam` couples structural and thermal: a beam near a heat source carries a
 *     thermal stress that eats into the allowable the load has to fit under.
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