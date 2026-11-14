import HoverHelp from '../ui/HoverHelp'
/**
 * Biology workspace: one sheet, six scales, and a solver behind every model.
 *
 * The rail on the left is the scale ladder — molecule, organelle, cell, tissue,
 * organ, system — and under it the models that scale actually has. Every row in
 * that list comes from `bioModelRows()`, the same index the library dock offers,
 * and loading a row goes through `loadBioModel`, which throws for an id it does
 * not know. A rail row and a dock row therefore cannot drift apart: there is one
 * list and one loader.
 *
 * Nothing on this screen is an illustration. Each view integrates its own model
 * and plots the samples that came back, so a curve the model cannot produce is a
 * curve that does not appear. The scale descriptions say what each resolution
 * leaves out, because a lumped windkessel is not a heart and a two-compartment
 * model is not a body.
 *
 * Dials are remembered per model. A multiplier set on the mitochondrion's leak
 * has no meaning for a capillary bed, so switching models cannot carry it over —
 * and switching back restores what was set.
 */
import { useCallback, useMemo, useState } from 'react'
import { Dna, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { cn } from '../../lib/utils'
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign'
import { useDomainLibraryZone } from '../../lib/library/useDomainLibraryZone'
import LibraryDropNote from '../library/LibraryDropNote'
import type { LibraryItem } from '../../lib/library/types'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { BIOLOGICAL_SCALES, SCALE_DEFINITIONS, scaleDefinition, type BiologicalScale } from '../../lib/biology/scales'
import { bioModelRows, loadBioModel, type BioModelRow, type LoadedBioModel } from '../../lib/biology/models'
import { BioRefusal, type BioViewControls } from './BioKit'
import MoleculeView from './MoleculeView'
import OrganelleView from './OrganelleView'
import CellView from './CellView'
import TissueView from './TissueView'
import OrganView from './OrganView'
import SystemView from './SystemView'

interface BiologyPanelProps {
  onClose: () => void
}

interface BiologyDesign {
  modelId?: unknown
  /** Saved dials, keyed by model id. */
  overrides?: unknown
}

type OverridesByModel = Record<string, Record<string, number>>

/**
 * Built once from the registries. `bioModelRows()` is a pure walk of the preset
 * tables, so the rail and the dock read the same array rather than each
 * rebuilding it on every render.
 */
const ALL_ROWS: readonly BioModelRow[] = bioModelRows()

const ROW_BY_ID = new Map(ALL_ROWS.map((row) => [row.id, row]))

const SCALE_COUNTS: Readonly<Record<BiologicalScale, number>> = BIOLOGICAL_SCALES.reduce(
  (counts, scale) => ({ ...counts, [scale]: ALL_ROWS.filter((row) => row.scale === scale).length }),
  {} as Record<BiologicalScale, number>,
)

const DEFAULT_MODEL_ID = ALL_ROWS[0].id

const NO_OVERRIDES: Readonly<Record<string, number>> = {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function firstRowAt(scale: BiologicalScale): BioModelRow {
  return ALL_ROWS.find((row) => row.scale === scale) ?? ALL_ROWS[0]
}

/**
 * A restored design is user data, not a promise.
 *
 * The registry can hand back an id from a build that has since renamed its
 * presets, or a dial value from a range the view has since narrowed. Dropping
 * what is not in the index — rather than loading it and refusing on screen —
 * is what makes reopening an old project a working workspace.
 */
function readDesign(saved: BiologyDesign | null): { modelId: string; overrides: OverridesByModel } {
  const modelId = typeof saved?.modelId === 'string' && ROW_BY_ID.has(saved.modelId) ? saved.modelId : DEFAULT_MODEL_ID
  const overrides: OverridesByModel = {}
  if (isRecord(saved?.overrides)) {
    for (const [id, dials] of Object.entries(saved.overrides)) {
      if (!ROW_BY_ID.has(id) || !isRecord(dials)) continue
      const numbers: Record<string, number> = {}
      for (const [key, value] of Object.entries(dials)) {
        if (typeof value === 'number' && Number.isFinite(value)) numbers[key] = value
      }
      if (Object.keys(numbers).length > 0) overrides[id] = numbers
    }
  }
  return { modelId, overrides }
}

/**
 * The view for one loaded model.
 *
 * The switch is not decoration: `LoadedBioModel` is a union keyed on `family`,
 * and each view takes the narrowed member it solves. Spreading the props alone
 * keeps the union, so the case body has to hand `loaded` over explicitly.
 */
function ModelView(props: BioViewControls & { loaded: LoadedBioModel }) {
  switch (props.loaded.family) {
    case 'kinetics':
      return <MoleculeView {...props} loaded={props.loaded} />
    case 'oxphos':
      return <OrganelleView {...props} loaded={props.loaded} />
    case 'hodgkin-huxley':
    case 'fitzhugh-nagumo':
    case 'integrate-and-fire':
    case 'gene-circuit':
      return <CellView {...props} loaded={props.loaded} />
    case 'cable':
    case 'oscillators':
      return <TissueView {...props} loaded={props.loaded} />
    case 'circulation':
    case 'starling':
      return <OrganView {...props} loaded={props.loaded} />
    case 'pharmacokinetics':
      return <SystemView {...props} loaded={props.loaded} />
  }
}

export default function BiologyPanel({ onClose }: BiologyPanelProps) {
  const [initial] = useState(() => readDesign(loadDomainDesign<BiologyDesign>('biology')))
  const [modelId, setModelId] = useState(initial.modelId)
  const [overridesByModel, setOverridesByModel] = useState<OverridesByModel>(initial.overrides)

  const activeRow = ROW_BY_ID.get(modelId) ?? ALL_ROWS[0]
  const activeScale = scaleDefinition(activeRow.scale)
  const rowsAtScale = useMemo(
    () => ALL_ROWS.filter((row) => row.scale === activeRow.scale),
    [activeRow.scale],
  )

  usePublishDomainDesign<BiologyDesign>(
    'biology',
    { modelId, overrides: overridesByModel },
    (saved) => {
      const restored = readDesign(saved)
      setModelId(restored.modelId)
      setOverridesByModel(restored.overrides)
    },
  )

  /**
   * Loading a row is the only way the workspace changes model.
   *
   * The rail, the dock and the restored design all arrive here, and an id the
   * index does not carry never becomes the active model — so the header, the rail
   * highlight and the solver below always describe the same row.
   */
  const loadModel = useCallback((id: string) => {
    if (ROW_BY_ID.has(id)) setModelId(id)
  }, [])

  const selectScale = useCallback((scale: BiologicalScale) => {
    setModelId(firstRowAt(scale).id)
  }, [])

  useDemoRequest('biology-afterload', () => {
    loadModel('organ-high-afterload')
  })

  const zone = useDomainLibraryZone({
    accepts: ['bio-model'],
    as: 'the biology workspace',
    onPlace: (item: LibraryItem) => {
      if (item.kind !== 'bio-model') return
      loadModel(item.payload.presetId)
    },
  })

  const controls = useMemo<BioViewControls>(
    () => ({
      overrides: overridesByModel[modelId] ?? NO_OVERRIDES,
      setOverride: (key, value) =>
        setOverridesByModel((previous) => ({ ...previous, [modelId]: { ...previous[modelId], [key]: value } })),
      resetOverrides: () =>
        setOverridesByModel((previous) => {
          const next = { ...previous }
          delete next[modelId]
          return next
        }),
    }),
    [modelId, overridesByModel],
  )

  const loaded = useMemo(() => {
    try {
      return { model: loadBioModel(modelId), error: null as string | null }
    } catch (error) {
      return { model: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [modelId])

  return (
    <div className="h-full overflow-auto bg-background p-4">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Dna className="h-5 w-5 flex-shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">Biology</h2>
              <p className="text-sm text-muted-foreground">
                Reaction networks to whole-body disposition, integrated at every scale — each curve is a solved run.
              </p>
            </div>
          </div>
          <HoverHelp title="Leave the biology workspace; closing writes nothing to the design." description="Leave the biology workspace; closing writes nothing to the design.">
<Button variant="ghost"
            size="icon"
            aria-label="Close biology workspace"
            onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
</HoverHelp>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Scale</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-col gap-1" role="group" aria-label="Biological scale">
                  {SCALE_DEFINITIONS.map((definition) => (
                    <Button
                      key={definition.id}
                      type="button"
                      size="sm"
                      variant={definition.id === activeScale.id ? 'default' : 'outline'}
                      className="justify-between"
                      aria-pressed={definition.id === activeScale.id}
                      onClick={() => selectScale(definition.id)}
                      title={`Show the ${SCALE_COUNTS[definition.id]} model${SCALE_COUNTS[definition.id] === 1 ? '' : 's'} at the ${definition.label.toLowerCase()} scale, and load the first one`}
                    >
                      <span>{definition.label}</span>
                      <span className="font-mono tabular-nums opacity-70">{SCALE_COUNTS[definition.id]}</span>
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{activeScale.resolves}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Not resolved here: </span>
                  {activeScale.doesNotResolve}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Models at this scale</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {rowsAtScale.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => loadModel(row.id)}
                    aria-pressed={row.id === modelId}
                    title={row.description}
                    className={cn(
                      'block w-full rounded-md border px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      row.id === modelId ? 'border-primary bg-primary/10' : 'border-border bg-background hover:bg-accent',
                    )}
                  >
                    <span className="block truncate text-sm font-medium">{row.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{row.spec}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="cad-dropzone" {...zone.zoneProps}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">{activeRow.name}</CardTitle>
                  <p className="truncate text-xs text-muted-foreground">
                    {activeRow.category} · {activeRow.spec}
                  </p>
                </div>
                <span className="flex-shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {activeScale.label} scale
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <LibraryDropNote zone={zone} surface="the biology workspace" className="cad-drop-note--inline" />
              {loaded.model ? (
                <ModelView {...controls} loaded={loaded.model} />
              ) : (
                <BioRefusal
                  error={loaded.error ?? 'The model index returned nothing.'}
                  advice="This row is in the library index but its solver refuses it, which means the catalog and the loaders disagree — pick another model and report this id."
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
