/**
 * The biological scales Folio models, and what each one's models actually are.
 *
 * Folio is cross-domain: a design can hold a PCB, a bracket and a perfusion
 * circuit in the same project. The biology domain spans from a reaction network
 * to a whole organ system, so the panel needs one shared vocabulary for "which
 * scale am I working at" — and each scale needs an honest statement of what its
 * model covers, because a lumped windkessel is not a heart.
 *
 * The size bands are order-of-magnitude context, not model inputs. Nothing in
 * the solvers reads them; they exist so a designer can tell at a glance whether
 * two models on the same sheet describe the same thing at different resolutions.
 */

export const BIOLOGICAL_SCALES = ['molecule', 'organelle', 'cell', 'tissue', 'organ', 'system'] as const

export type BiologicalScale = (typeof BIOLOGICAL_SCALES)[number]

export interface ScaleDefinition {
  id: BiologicalScale
  label: string
  /** Order-of-magnitude feature size, metres. Context only, never an input. */
  sizeMeters: number
  /** What a model at this scale resolves. */
  resolves: string
  /** What it does not — the sentence that keeps a plot from being over-read. */
  doesNotResolve: string
}

export const SCALE_DEFINITIONS: readonly ScaleDefinition[] = [
  {
    id: 'molecule',
    label: 'Molecule',
    sizeMeters: 1e-9,
    resolves: 'Species concentrations and reaction fluxes: enzyme kinetics, binding curves, gene circuits.',
    doesNotResolve: 'Molecular structure, diffusion-limited encounter rates, conformational change or stochastic '
      + 'expression noise — concentrations are treated as well-mixed and continuous.',
  },
  {
    id: 'organelle',
    label: 'Organelle',
    sizeMeters: 1e-6,
    resolves: 'A single mitochondrion as an energy converter: proton-motive force, respiratory control, ATP output.',
    doesNotResolve: 'Crist geometry, individual complex assemblies, metabolite transport beyond the lumped '
      + 'adenylate pool, or the organelle network’s fission and fusion.',
  },
  {
    id: 'cell',
    label: 'Cell',
    sizeMeters: 2e-5,
    resolves: 'Membrane excitability: Hodgkin–Huxley and FitzHugh–Nagumo potentials, thresholds, refractory periods.',
    doesNotResolve: 'Intracellular signalling cascades, morphology, ion-concentration gradients that the model '
      + 'assumes constant, or the full complement of channel types a real cell expresses.',
  },
  {
    id: 'tissue',
    label: 'Tissue',
    sizeMeters: 1e-3,
    resolves: 'Coupled cells: one-dimensional conduction of an excitation front, and synchronisation of a '
      + 'population of oscillators.',
    doesNotResolve: 'Three-dimensional anisotropy, fibrosis, vessel networks, or mechanical coupling between cells. '
      + 'The cable is a line of compartments, not a sheet.',
  },
  {
    id: 'organ',
    label: 'Organ',
    sizeMeters: 1e-2,
    resolves: 'The left ventricle against its arterial tree: pressure–volume behaviour, stroke volume, and '
      + 'capillary filtration from the Starling forces.',
    doesNotResolve: 'Valve dynamics beyond ideal one-way behaviour, pericardial constraint, chamber geometry '
      + 'changes, or the four-chamber circulation. It is a lumped hydraulic analogue.',
  },
  {
    id: 'system',
    label: 'System',
    sizeMeters: 1e-1,
    resolves: 'Whole-body disposition of a compound: one- and two-compartment pharmacokinetics, dosing regimens, '
      + 'exposure metrics.',
    doesNotResolve: 'Physiology-based (PBPK) organ blood flows, metabolite kinetics, transporters, or inter- '
      + 'subject variability. Compartments are fitting buckets, not organs.',
  },
]

export function scaleDefinition(scale: BiologicalScale): ScaleDefinition {
  const found = SCALE_DEFINITIONS.find((definition) => definition.id === scale)
  if (!found) throw new Error(`No scale definition registered for "${scale}".`)
  return found
}
