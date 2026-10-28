/**
 * Power-grid workspace: balanced AC load flow for a transmission study and a
 * radial distribution feeder.
 *
 * Every number on screen comes from `src/lib/power/loadFlow`; the panel edits
 * the case and renders the returned buses, flows and violations. When a case
 * does not converge or an edit makes the network invalid, the banner says so
 * and the tables are labelled as the last iterate rather than a solution.
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Grid3X3, Plus, Trash2, X } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign'
import { describeError } from '../../lib/utils'
import {
  solvePowerFlow,
  solveRadialFeeder,
  type FeederNode,
  type FeederSection,
  type PowerBranch,
  type PowerBus,
  type PowerFlowResult,
  type RadialFeederInput,
  type RadialFeederResult,
} from '../../lib/power/loadFlow'

interface PowerGridPanelProps {
  onClose: () => void
}

type PanelTab = 'transmission' | 'distribution'

const Z_BASE_230 = (230 * 230) / 100

const ohms230 = (pu: number): number => pu * Z_BASE_230

const THREE_BUS: { buses: PowerBus[]; branches: PowerBranch[] } = {
  buses: [
    { id: 'Bus 1', type: 'slack', baseKv: 230, voltageSetpointPu: 1.05 },
    {
      id: 'Bus 2',
      type: 'pv',
      baseKv: 230,
      voltageSetpointPu: 1.02,
      generationMw: 50,
      reactiveMinMvar: -200,
      reactiveMaxMvar: 200,
    },
    { id: 'Bus 3', type: 'pq', baseKv: 230, loadMw: 90, loadMvar: 30 },
  ],
  branches: [
    { id: 'L1-2', from: 'Bus 1', to: 'Bus 2', resistanceOhm: ohms230(0.02), reactanceOhm: ohms230(0.06), ratingMva: 100 },
    { id: 'L1-3', from: 'Bus 1', to: 'Bus 3', resistanceOhm: ohms230(0.03), reactanceOhm: ohms230(0.09), ratingMva: 100 },
    { id: 'L2-3', from: 'Bus 2', to: 'Bus 3', resistanceOhm: ohms230(0.025), reactanceOhm: ohms230(0.075), ratingMva: 100 },
  ],
}

const FIVE_BUS: { buses: PowerBus[]; branches: PowerBranch[] } = {
  buses: [
    { id: 'North', type: 'slack', baseKv: 110, voltageSetpointPu: 1.02 },
    {
      id: 'Hydro',
      type: 'pv',
      baseKv: 110,
      voltageSetpointPu: 1.01,
      generationMw: 80,
      reactiveMinMvar: -60,
      reactiveMaxMvar: 60,
    },
    {
      id: 'CCGT',
      type: 'pv',
      baseKv: 110,
      voltageSetpointPu: 1.0,
      generationMw: 40,
      reactiveMinMvar: -40,
      reactiveMaxMvar: 40,
    },
    { id: 'Foundry', type: 'pq', baseKv: 110, loadMw: 60, loadMvar: 20 },
    { id: 'Town', type: 'pq', baseKv: 110, loadMw: 70, loadMvar: 25 },
  ],
  branches: [
    { id: 'N-H', from: 'North', to: 'Hydro', resistanceOhm: 1.21, reactanceOhm: 6.05, ratingMva: 150 },
    { id: 'H-C', from: 'Hydro', to: 'CCGT', resistanceOhm: 2.42, reactanceOhm: 9.68, ratingMva: 100 },
    { id: 'C-F', from: 'CCGT', to: 'Foundry', resistanceOhm: 1.815, reactanceOhm: 7.26, ratingMva: 100 },
    { id: 'F-T', from: 'Foundry', to: 'Town', resistanceOhm: 2.42, reactanceOhm: 8.47, ratingMva: 100 },
    { id: 'T-N', from: 'Town', to: 'North', resistanceOhm: 1.21, reactanceOhm: 6.05, ratingMva: 100 },
    { id: 'H-T', from: 'Hydro', to: 'Town', resistanceOhm: 3.025, reactanceOhm: 10.89, ratingMva: 100 },
    { id: 'C-T', from: 'CCGT', to: 'Town', resistanceOhm: 3.63, reactanceOhm: 12.1, ratingMva: 100 },
  ],
}

const TWO_BUS_STRESSED: { buses: PowerBus[]; branches: PowerBranch[] } = {
  buses: [
    { id: 'Source', type: 'slack', baseKv: 230, voltageSetpointPu: 1 },
    { id: 'Load', type: 'pq', baseKv: 230, loadMw: 300, loadMvar: 100 },
  ],
  branches: [
    { id: 'Tie', from: 'Source', to: 'Load', resistanceOhm: ohms230(0.01), reactanceOhm: ohms230(0.1), ratingMva: 350 },
  ],
}

const TRANSMISSION_CASES: ReadonlyArray<{
  id: string
  name: string
  note: string
  buses: PowerBus[]
  branches: PowerBranch[]
}> = [
  { id: 'three-bus', name: 'Three-bus study', note: 'One slack, one PV generator and a 90 MW load; meshed 230 kV lines.', ...THREE_BUS },
  { id: 'five-bus', name: 'Five-bus mesh', note: 'Two generators serving a foundry and a town across a 110 kV mesh.', ...FIVE_BUS },
  { id: 'two-bus', name: 'Two-bus stressed tie', note: 'A long tie feeding 300 MW; raise the demand scale until the transfer limit is reached.', ...TWO_BUS_STRESSED },
]

interface FeederCase {
  id: string
  name: string
  note: string
  input: RadialFeederInput
}

const URBAN_LV: FeederCase = {
  id: 'urban-lv',
  name: 'Urban 400 V feeder',
  note: 'Three LV pockets on 400 V cable; 90 kW peak demand.',
  input: {
    sourceKv: 0.4,
    sourceVoltagePu: 1,
    sourceId: 'Tx',
    nodes: [
      { id: 'Tx' },
      { id: 'Kiosk A', loadKw: 40, loadKvar: 12 },
      { id: 'Kiosk B', loadKw: 30, loadKvar: 10 },
      { id: 'Kiosk C', loadKw: 20, loadKvar: 5 },
    ],
    sections: [
      { id: 'S1', from: 'Tx', to: 'Kiosk A', resistanceOhm: 0.04, reactanceOhm: 0.03 },
      { id: 'S2', from: 'Kiosk A', to: 'Kiosk B', resistanceOhm: 0.05, reactanceOhm: 0.035 },
      { id: 'S3', from: 'Kiosk B', to: 'Kiosk C', resistanceOhm: 0.06, reactanceOhm: 0.04 },
    ],
  },
}

const RURAL_MV: FeederCase = {
  id: 'rural-mv',
  name: 'Rural 11 kV feeder',
  note: 'A 6 km 11 kV spur with 250 kW of farm load and 30 kW of local generation.',
  input: {
    sourceKv: 11,
    sourceVoltagePu: 1.02,
    sourceId: 'Substation',
    nodes: [
      { id: 'Substation' },
      { id: 'Farm 1', loadKw: 60, loadKvar: 20 },
      { id: 'Farm 2', loadKw: 70, loadKvar: 25 },
      { id: 'Pump', loadKw: 60, loadKvar: 15 },
      { id: 'Village', loadKw: 60, loadKvar: 22, generationKw: 30 },
    ],
    sections: [
      { id: 'S1', from: 'Substation', to: 'Farm 1', resistanceOhm: 1.5, reactanceOhm: 2.0 },
      { id: 'S2', from: 'Farm 1', to: 'Farm 2', resistanceOhm: 1.7, reactanceOhm: 2.2 },
      { id: 'S3', from: 'Farm 2', to: 'Pump', resistanceOhm: 1.8, reactanceOhm: 2.3 },
      { id: 'S4', from: 'Pump', to: 'Village', resistanceOhm: 1.9, reactanceOhm: 2.4 },
    ],
  },
}

const FEEDER_CASES: readonly FeederCase[] = [URBAN_LV, RURAL_MV]

interface GridDesign {
  tab?: PanelTab
  txCaseId?: string
  txScale?: number
  txBuses?: PowerBus[]
  txBranches?: PowerBranch[]
  feederCaseId?: string
  feeder?: RadialFeederInput
}

const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const cloneBuses = (buses: readonly PowerBus[]): PowerBus[] => buses.map((bus) => ({ ...bus }))
const cloneBranches = (branches: readonly PowerBranch[]): PowerBranch[] =>
  branches.map((branch) => ({ ...branch, seriesImpedancePu: branch.seriesImpedancePu ? { ...branch.seriesImpedancePu } : undefined }))

/** A deterministic id that does not collide with one already in the case. */
function uniqueId(prefix: string, taken: readonly string[]): string {
  let suffix = 1
  while (taken.includes(`${prefix}-${suffix}`)) suffix += 1
  return `${prefix}-${suffix}`
}
const cloneFeeder = (input: RadialFeederInput): RadialFeederInput => ({
  ...input,
  nodes: input.nodes.map((node) => ({ ...node })),
  sections: input.sections.map((section) => ({ ...section })),
})

function isBusArray(value: unknown): value is PowerBus[] {
  return Array.isArray(value) && value.every((entry) => entry && typeof entry === 'object' && typeof (entry as PowerBus).id === 'string')
}

function isBranchArray(value: unknown): value is PowerBranch[] {
  return Array.isArray(value) && value.every((entry) => entry && typeof entry === 'object' && typeof (entry as PowerBranch).id === 'string')
}

function isFeeder(value: unknown): value is RadialFeederInput {
  if (!value || typeof value !== 'object') return false
  const feeder = value as RadialFeederInput
  return (
    typeof feeder.sourceKv === 'number' &&
    typeof feeder.sourceId === 'string' &&
    Array.isArray(feeder.nodes) &&
    feeder.nodes.every((node) => node && typeof node === 'object' && typeof (node as FeederNode).id === 'string') &&
    Array.isArray(feeder.sections) &&
    feeder.sections.every(
      (section) => section && typeof section === 'object' && typeof (section as FeederSection).id === 'string',
    )
  )
}

const fmt = (value: number, digits = 1): string => (Number.isFinite(value) ? value.toFixed(digits) : '—')

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="cad-readout mt-1 text-lg font-semibold">{value}</div>
      {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
    </div>
  )
}

export default function PowerGridPanel({ onClose }: PowerGridPanelProps) {
  const saved = loadDomainDesign<GridDesign>('grid')
  const savedCase = TRANSMISSION_CASES.find((entry) => entry.id === saved?.txCaseId)
  const savedFeederCase = FEEDER_CASES.find((entry) => entry.id === saved?.feederCaseId)

  const [tab, setTab] = useState<PanelTab>(saved?.tab === 'distribution' ? 'distribution' : 'transmission')
  const [txCaseId, setTxCaseId] = useState(savedCase?.id ?? TRANSMISSION_CASES[0].id)
  const [txBuses, setTxBuses] = useState<PowerBus[]>(() =>
    isBusArray(saved?.txBuses) && saved.txBuses.length > 0 ? cloneBuses(saved.txBuses) : cloneBuses(THREE_BUS.buses),
  )
  const [txBranches, setTxBranches] = useState<PowerBranch[]>(() =>
    isBranchArray(saved?.txBranches) ? cloneBranches(saved.txBranches) : cloneBranches(THREE_BUS.branches),
  )
  const [txScale, setTxScale] = useState(finiteNumber(saved?.txScale, 1))
  const [feederCaseId, setFeederCaseId] = useState(savedFeederCase?.id ?? FEEDER_CASES[0].id)
  const [feeder, setFeeder] = useState<RadialFeederInput>(() =>
    isFeeder(saved?.feeder) ? cloneFeeder(saved.feeder) : cloneFeeder(URBAN_LV.input),
  )
  usePublishDomainDesign<GridDesign>('grid', {
    tab,
    txCaseId,
    txScale,
    txBuses,
    txBranches,
    feederCaseId,
    feeder,
  })

  const applyTransmissionCase = (id: string): void => {
    const entry = TRANSMISSION_CASES.find((candidate) => candidate.id === id)
    if (!entry) return
    setTxCaseId(entry.id)
    setTxBuses(cloneBuses(entry.buses))
    setTxBranches(cloneBranches(entry.branches))
    setTxScale(1)
  }

  const applyFeederCase = (id: string): void => {
    const entry = FEEDER_CASES.find((candidate) => candidate.id === id)
    if (!entry) return
    setFeederCaseId(entry.id)
    setFeeder(cloneFeeder(entry.input))
  }

  useDemoRequest('grid-transmission', () => {
    setTab('transmission')
    applyTransmissionCase('three-bus')
  })
  useDemoRequest('grid-distribution', () => {
    setTab('distribution')
    setFeederCaseId(RURAL_MV.id)
    setFeeder(cloneFeeder(RURAL_MV.input))
  })

  const scaledBuses = useMemo(
    () =>
      txBuses.map((bus) => ({
        ...bus,
        loadMw: bus.loadMw === undefined ? undefined : bus.loadMw * txScale,
        loadMvar: bus.loadMvar === undefined ? undefined : bus.loadMvar * txScale,
      })),
    [txBuses, txScale],
  )

  const transmission = useMemo((): { result: PowerFlowResult | null; error: string | null } => {
    try {
      return {
        result: solvePowerFlow({
          baseMva: 100,
          buses: scaledBuses,
          branches: txBranches,
        }),
        error: null,
      }
    } catch (error) {
      return { result: null, error: describeError(error) }
    }
  }, [scaledBuses, txBranches])

  const distribution = useMemo((): { result: RadialFeederResult | null; error: string | null } => {
    try {
      return { result: solveRadialFeeder(feeder), error: null }
    } catch (error) {
      return { result: null, error: describeError(error) }
    }
  }, [feeder])

  const updateBus = (index: number, patch: Partial<PowerBus>): void => {
    setTxBuses((buses) => buses.map((bus, position) => (position === index ? { ...bus, ...patch } : bus)))
  }

  const updateBranch = (index: number, patch: Partial<PowerBranch>): void => {
    setTxBranches((branches) => branches.map((branch, position) => (position === index ? { ...branch, ...patch } : branch)))
  }

  const addBus = (): void => {
    const slackBus = txBuses.find((bus) => bus.type === 'slack') ?? txBuses[0]
    if (!slackBus) return
    let suffix = txBuses.length + 1
    while (txBuses.some((bus) => bus.id === `Bus ${suffix}`)) suffix += 1
    const id = `Bus ${suffix}`
    const zBase = (slackBus.baseKv * slackBus.baseKv) / 100
    setTxBuses([...txBuses, { id, type: 'pq', baseKv: slackBus.baseKv, loadMw: 20, loadMvar: 5 }])
    setTxBranches([
      ...txBranches,
      {
        id: uniqueId('L-new', txBranches.map((branch) => branch.id)),
        from: slackBus.id,
        to: id,
        resistanceOhm: 0.04 * zBase,
        reactanceOhm: 0.12 * zBase,
        ratingMva: 100,
      },
    ])
  }

  const changeBusType = (index: number, type: PowerBus['type']): void => {
    const bus = txBuses[index]
    if (!bus || bus.type === 'slack') return
    if (type === 'pq') {
      // A PQ bus cannot carry a scheduled active-power injection in this model;
      // clearing it keeps a type switch from failing validation.
      updateBus(index, { type: 'pq', generationMw: 0 })
    } else {
      updateBus(index, { type: 'pv', voltageSetpointPu: bus.voltageSetpointPu ?? 1 })
    }
  }

  const removeBus = (index: number): void => {
    const target = txBuses[index]
    if (!target || target.type === 'slack') return
    setTxBuses((buses) => buses.filter((_, position) => position !== index))
    setTxBranches((branches) => branches.filter((branch) => branch.from !== target.id && branch.to !== target.id))
  }

  const addBranch = (): void => {
    const first = txBuses[0]
    const second = txBuses[txBuses.length - 1]
    if (!first || !second || txBuses.length < 2) return
    const zBase = (first.baseKv * first.baseKv) / 100
    setTxBranches((branches) => [
      ...branches,
      {
        id: uniqueId('L-new', branches.map((branch) => branch.id)),
        from: first.id,
        to: second.id,
        resistanceOhm: 0.02 * zBase,
        reactanceOhm: 0.1 * zBase,
        ratingMva: 100,
      },
    ])
  }

  const updateFeederNode = (index: number, patch: Partial<FeederNode>): void => {
    setFeeder((current) => ({
      ...current,
      nodes: current.nodes.map((node, position) => (position === index ? { ...node, ...patch } : node)),
    }))
  }

  const updateFeederSection = (index: number, patch: Partial<FeederSection>): void => {
    setFeeder((current) => ({
      ...current,
      sections: current.sections.map((section, position) =>
        position === index ? { ...section, ...patch } : section,
      ),
    }))
  }

  const addFeederNode = (): void => {
    setFeeder((current) => {
      const previous = current.nodes[current.nodes.length - 1]
      if (!previous) return current
      let suffix = current.nodes.length
      while (current.nodes.some((node) => node.id === `Load ${suffix}`)) suffix += 1
      const id = `Load ${suffix}`
      return {
        ...current,
        nodes: [...current.nodes, { id, loadKw: 20, loadKvar: 6 }],
        sections: [
          ...current.sections,
          {
            id: uniqueId('S-new', current.sections.map((section) => section.id)),
            from: previous.id,
            to: id,
            resistanceOhm: 0.05,
            reactanceOhm: 0.035,
          },
        ],
      }
    })
  }

  const removeFeederNode = (): void => {
    setFeeder((current) => {
      if (current.nodes.length <= 1) return current
      const last = current.nodes[current.nodes.length - 1]
      return {
        ...current,
        nodes: current.nodes.slice(0, -1),
        sections: current.sections.filter((section) => section.to !== last.id),
      }
    })
  }

  const txResult = transmission.result
  const txWarnings: string[] = []
  if (txResult) {
    txResult.buses.forEach((bus) => {
      if (bus.voltagePu < 0.95) txWarnings.push(`${bus.id} sits at ${fmt(bus.voltagePu, 3)} pu, below the 0.95 pu planning floor.`)
      if (bus.voltagePu > 1.05) txWarnings.push(`${bus.id} sits at ${fmt(bus.voltagePu, 3)} pu, above the 1.05 pu planning ceiling.`)
    })
    txResult.branches.forEach((branch) => {
      if (branch.loadingPercent !== null && branch.loadingPercent > 100) {
        txWarnings.push(`${branch.id} carries ${fmt(branch.loadingPercent, 0)}% of its thermal rating.`)
      }
    })
    txWarnings.push(...txResult.notes)
  }

  const feederResult = distribution.result
  const feederWarnings: string[] = []
  if (feederResult) {
    feederResult.nodes.forEach((node) => {
      if (node.voltagePu < 0.94) feederWarnings.push(`${node.id} is at ${fmt(node.voltagePu, 3)} pu, below the 0.94 pu distribution limit.`)
    })
  }

  return (
    <div className="h-full overflow-auto bg-background p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <Grid3X3 className="h-5 w-5 text-primary" aria-hidden="true" />
              Power Grid
            </h2>
            <p className="text-sm text-muted-foreground">
              Balanced positive-sequence load flow for transmission networks and radial distribution feeders.
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close power grid" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div role="tablist" aria-label="Power grid study" className="flex flex-wrap gap-1">
          <Button
            role="tab"
            aria-selected={tab === 'transmission'}
            variant={tab === 'transmission' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('transmission')}
          >
            Transmission
          </Button>
          <Button
            role="tab"
            aria-selected={tab === 'distribution'}
            variant={tab === 'distribution' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('distribution')}
          >
            Distribution
          </Button>
        </div>

        {tab === 'transmission' ? (
          <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Case</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Study</span>
                    <select
                      value={txCaseId}
                      onChange={(event) => applyTransmissionCase(event.target.value)}
                      aria-label="Transmission study"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {TRANSMISSION_CASES.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted-foreground">
                      {TRANSMISSION_CASES.find((entry) => entry.id === txCaseId)?.note}
                    </span>
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="flex items-center justify-between">
                      <span>Demand scale</span>
                      <span className="cad-readout">{txScale.toFixed(2)}×</span>
                    </span>
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.05"
                      value={txScale}
                      onChange={(event) => setTxScale(Number(event.target.value))}
                      aria-label="Demand scale"
                      className="w-full"
                    />
                    <span className="text-xs text-muted-foreground">
                      Scales every bus load; generation setpoints stay fixed. Push the stressed tie past its transfer limit to see the solver refuse.
                    </span>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Base 100 MVA. Branch impedances are edited in ohms on each study's voltage base; the solver converts
                    them per unit as Z&#8202;/&#8202;(kV²/MVA). A branch between two voltage levels needs per-unit data and is
                    not editable here.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-base">Buses</CardTitle>
                  <Button size="sm" variant="outline" onClick={addBus} aria-label="Add bus">
                    <Plus className="mr-1 h-3.5 w-3.5" /> Bus
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {txBuses.map((bus, index) => (
                    <div key={bus.id} className="rounded-md border border-border p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{bus.id}</span>
                        <div className="flex items-center gap-1">
                          <select
                            value={bus.type}
                            onChange={(event) => changeBusType(index, event.target.value as PowerBus['type'])}
                            aria-label={`Type of ${bus.id}`}
                            disabled={bus.type === 'slack'}
                            className="h-8 rounded border border-input bg-background px-2 text-xs disabled:opacity-60"
                          >
                            {bus.type === 'slack' && <option value="slack">Slack</option>}
                            <option value="pv">PV</option>
                            <option value="pq">PQ</option>
                          </select>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeBus(index)}
                            disabled={bus.type === 'slack'}
                            aria-label={`Remove ${bus.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <label className="block text-xs">
                          <span className="text-muted-foreground">Load MW</span>
                          <Input
                            type="number"
                            step="1"
                            value={bus.loadMw ?? 0}
                            onChange={(event) => updateBus(index, { loadMw: Number(event.target.value) })}
                            aria-label={`Load MW at ${bus.id}`}
                            className="h-8"
                          />
                        </label>
                        <label className="block text-xs">
                          <span className="text-muted-foreground">Load Mvar</span>
                          <Input
                            type="number"
                            step="1"
                            value={bus.loadMvar ?? 0}
                            onChange={(event) => updateBus(index, { loadMvar: Number(event.target.value) })}
                            aria-label={`Load Mvar at ${bus.id}`}
                            className="h-8"
                          />
                        </label>
                        {(bus.type === 'slack' || bus.type === 'pv') && (
                          <label className="block text-xs">
                            <span className="text-muted-foreground">V set (pu)</span>
                            <Input
                              type="number"
                              step="0.01"
                              value={bus.voltageSetpointPu ?? 1}
                              onChange={(event) => updateBus(index, { voltageSetpointPu: Number(event.target.value) })}
                              aria-label={`Voltage setpoint at ${bus.id}`}
                              className="h-8"
                            />
                          </label>
                        )}
                        {bus.type === 'pv' && (
                          <>
                            <label className="block text-xs">
                              <span className="text-muted-foreground">Gen MW</span>
                              <Input
                                type="number"
                                step="1"
                                value={bus.generationMw ?? 0}
                                onChange={(event) => updateBus(index, { generationMw: Number(event.target.value) })}
                                aria-label={`Generation MW at ${bus.id}`}
                                className="h-8"
                              />
                            </label>
                            <label className="block text-xs">
                              <span className="text-muted-foreground">Q min (Mvar)</span>
                              <Input
                                type="number"
                                step="1"
                                value={bus.reactiveMinMvar ?? 0}
                                onChange={(event) => updateBus(index, { reactiveMinMvar: Number(event.target.value) })}
                                aria-label={`Reactive minimum at ${bus.id}`}
                                className="h-8"
                              />
                            </label>
                            <label className="block text-xs">
                              <span className="text-muted-foreground">Q max (Mvar)</span>
                              <Input
                                type="number"
                                step="1"
                                value={bus.reactiveMaxMvar ?? 0}
                                onChange={(event) => updateBus(index, { reactiveMaxMvar: Number(event.target.value) })}
                                aria-label={`Reactive maximum at ${bus.id}`}
                                className="h-8"
                              />
                            </label>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-base">Branches</CardTitle>
                  <Button size="sm" variant="outline" onClick={addBranch} aria-label="Add branch">
                    <Plus className="mr-1 h-3.5 w-3.5" /> Branch
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {txBranches.map((branch, index) => (
                    <div key={branch.id} className="rounded-md border border-border p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {branch.from} → {branch.to}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setTxBranches((branches) => branches.filter((_, position) => position !== index))}
                          aria-label={`Remove branch ${branch.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <label className="block text-xs">
                          <span className="text-muted-foreground">R (Ω)</span>
                          <Input
                            type="number"
                            step="0.1"
                            value={branch.resistanceOhm ?? 0}
                            onChange={(event) => updateBranch(index, { resistanceOhm: Number(event.target.value), seriesImpedancePu: undefined })}
                            aria-label={`Resistance of ${branch.id}`}
                            className="h-8"
                          />
                        </label>
                        <label className="block text-xs">
                          <span className="text-muted-foreground">X (Ω)</span>
                          <Input
                            type="number"
                            step="0.1"
                            value={branch.reactanceOhm ?? 0}
                            onChange={(event) => updateBranch(index, { reactanceOhm: Number(event.target.value), seriesImpedancePu: undefined })}
                            aria-label={`Reactance of ${branch.id}`}
                            className="h-8"
                          />
                        </label>
                        <label className="block text-xs">
                          <span className="text-muted-foreground">Rating MVA</span>
                          <Input
                            type="number"
                            step="5"
                            value={branch.ratingMva ?? 0}
                            onChange={(event) =>
                              updateBranch(index, { ratingMva: Number(event.target.value) > 0 ? Number(event.target.value) : undefined })
                            }
                            aria-label={`Rating of ${branch.id}`}
                            className="h-8"
                          />
                        </label>
                        <label className="block text-xs">
                          <span className="text-muted-foreground">Tap</span>
                          <Input
                            type="number"
                            step="0.01"
                            value={branch.tapRatio ?? 1}
                            onChange={(event) => updateBranch(index, { tapRatio: Number(event.target.value) })}
                            aria-label={`Tap ratio of ${branch.id}`}
                            className="h-8"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <div
                role="status"
                className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                  transmission.error || (txResult && !txResult.converged)
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {transmission.error || (txResult && !txResult.converged) ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span>
                  {transmission.error
                    ? `The case cannot be solved: ${transmission.error}`
                    : txResult && !txResult.converged
                      ? `Power flow did not converge after ${txResult.iterations} Newton iterations. Bus values below are the last iterate, not a solution.`
                      : txResult
                        ? `Power flow converged in ${txResult.iterations} iteration${txResult.iterations === 1 ? '' : 's'} with a ${txResult.maxMismatchPu.toExponential(1)} pu mismatch.`
                        : 'Waiting for a case.'}
                </span>
              </div>

              {txResult && (
                <>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Kpi label="Generation" value={`${fmt(txResult.totalGenerationMw)} MW`} detail={`${fmt(txResult.totalGenerationMvar)} Mvar`} />
                    <Kpi label="Demand" value={`${fmt(txResult.totalLoadMw)} MW`} detail={`${fmt(txResult.totalLoadMvar)} Mvar`} />
                    <Kpi label="Losses" value={`${fmt(txResult.totalLossMw, 3)} MW`} detail={`${fmt(txResult.totalLossMvar, 3)} Mvar`} />
                    <Kpi label="Minimum voltage" value={`${fmt(txResult.minVoltagePu, 4)} pu`} detail="planning range 0.95–1.05 pu" />
                    <Kpi
                      label="Peak loading"
                      value={txResult.maxLoadingPercent === null ? 'not rated' : `${fmt(txResult.maxLoadingPercent, 1)}%`}
                      detail="of the thermal rating"
                    />
                    <Kpi label="Iterations" value={String(txResult.iterations)} detail={txResult.converged ? 'converged' : 'stopped without a solution'} />
                  </div>

                  {txWarnings.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">What the solve flags</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {txWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Bus results</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-sm">
                        <caption className="sr-only">Bus voltages, angles and power injections</caption>
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th scope="col" className="py-2 pr-3">Bus</th>
                            <th scope="col" className="py-2 pr-3">Type</th>
                            <th scope="col" className="py-2 pr-3 text-right">V (pu)</th>
                            <th scope="col" className="py-2 pr-3 text-right">Angle (°)</th>
                            <th scope="col" className="py-2 pr-3 text-right">Gen MW</th>
                            <th scope="col" className="py-2 pr-3 text-right">Gen Mvar</th>
                            <th scope="col" className="py-2 text-right">Load MW</th>
                          </tr>
                        </thead>
                        <tbody>
                          {txResult.buses.map((bus) => (
                            <tr key={bus.id} className="border-b border-border/60 last:border-0">
                              <td className="py-1.5 pr-3 font-medium">{bus.id}</td>
                              <td className="py-1.5 pr-3">
                                <Badge variant={bus.reactiveLimited ? 'destructive' : 'secondary'} className="uppercase">
                                  {bus.reactiveLimited ? 'PQ at Q limit' : bus.type}
                                </Badge>
                              </td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(bus.voltagePu, 4)}</td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(bus.angleDeg, 2)}</td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(bus.generationMw, 2)}</td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(bus.generationMvar, 2)}</td>
                              <td className="cad-readout py-1.5 text-right">{fmt(bus.loadMw, 2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Branch flows and losses</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <caption className="sr-only">Branch sending-end and receiving-end power flows</caption>
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th scope="col" className="py-2 pr-3">Branch</th>
                            <th scope="col" className="py-2 pr-3 text-right">P from (MW)</th>
                            <th scope="col" className="py-2 pr-3 text-right">Q from (Mvar)</th>
                            <th scope="col" className="py-2 pr-3 text-right">P to (MW)</th>
                            <th scope="col" className="py-2 pr-3 text-right">Loss (MW)</th>
                            <th scope="col" className="py-2 text-right">Loading</th>
                          </tr>
                        </thead>
                        <tbody>
                          {txResult.branches.map((branch) => (
                            <tr key={branch.id} className="border-b border-border/60 last:border-0">
                              <td className="py-1.5 pr-3 font-medium">
                                {branch.from} → {branch.to}
                              </td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(branch.fromFlowMw, 2)}</td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(branch.fromFlowMvar, 2)}</td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(branch.toFlowMw, 2)}</td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(branch.lossMw, 3)}</td>
                              <td
                                className={`cad-readout py-1.5 text-right ${
                                  branch.loadingPercent !== null && branch.loadingPercent > 100 ? 'text-destructive' : ''
                                }`}
                              >
                                {branch.loadingPercent === null ? '—' : `${fmt(branch.loadingPercent, 1)}%`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                </>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Model basis and limits</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    Polar Newton–Raphson on the per-unit Y-bus with analytic Jacobian and a backtracking line search.
                    PV buses that exceed a reactive limit are held at that limit and re-solved as PQ. Slack Mvar is
                    reported without a limit.
                  </p>
                  <p>
                    Positive-sequence, balanced, constant-power loads. No transient stability, protection coordination,
                    harmonics, unbalanced phases, voltage regulators or transformer taps beyond the declared ratio.
                    Branch charging is a declared Mvar value, not derived from geometry.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Feeder</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Study</span>
                    <select
                      value={feederCaseId}
                      onChange={(event) => applyFeederCase(event.target.value)}
                      aria-label="Feeder study"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {FEEDER_CASES.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted-foreground">
                      {FEEDER_CASES.find((entry) => entry.id === feederCaseId)?.note}
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs">
                      <span className="text-muted-foreground">Source kV</span>
                      <Input
                        type="number"
                        step="0.1"
                        value={feeder.sourceKv}
                        onChange={(event) =>
                          setFeeder((current) => ({ ...current, sourceKv: Number(event.target.value) }))
                        }
                        aria-label="Source kV"
                        className="h-8"
                      />
                    </label>
                    <label className="block text-xs">
                      <span className="text-muted-foreground">Source pu</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={feeder.sourceVoltagePu ?? 1}
                        onChange={(event) =>
                          setFeeder((current) => ({ ...current, sourceVoltagePu: Number(event.target.value) }))
                        }
                        aria-label="Source voltage pu"
                        className="h-8"
                      />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={addFeederNode} aria-label="Add load node">
                      <Plus className="mr-1 h-3.5 w-3.5" /> Node
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={removeFeederNode}
                      disabled={feeder.nodes.length <= 1}
                      aria-label="Remove last load node"
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Last node
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Node demand</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {feeder.nodes.filter((node) => node.id !== feeder.sourceId).map((node) => {
                    const index = feeder.nodes.findIndex((entry) => entry.id === node.id)
                    return (
                      <div key={node.id} className="rounded-md border border-border p-2">
                        <span className="text-sm font-medium">{node.id}</span>
                        <div className="mt-1 grid grid-cols-3 gap-2">
                          <label className="block text-xs">
                            <span className="text-muted-foreground">Load kW</span>
                            <Input
                              type="number"
                              step="1"
                              value={node.loadKw ?? 0}
                              onChange={(event) => updateFeederNode(index, { loadKw: Number(event.target.value) })}
                              aria-label={`Load kW at ${node.id}`}
                              className="h-8"
                            />
                          </label>
                          <label className="block text-xs">
                            <span className="text-muted-foreground">Load kvar</span>
                            <Input
                              type="number"
                              step="1"
                              value={node.loadKvar ?? 0}
                              onChange={(event) => updateFeederNode(index, { loadKvar: Number(event.target.value) })}
                              aria-label={`Load kvar at ${node.id}`}
                              className="h-8"
                            />
                          </label>
                          <label className="block text-xs">
                            <span className="text-muted-foreground">Gen kW</span>
                            <Input
                              type="number"
                              step="1"
                              value={node.generationKw ?? 0}
                              onChange={(event) => updateFeederNode(index, { generationKw: Number(event.target.value) })}
                              aria-label={`Generation kW at ${node.id}`}
                              className="h-8"
                            />
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Sections</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {feeder.sections.map((section, index) => (
                    <div key={section.id} className="rounded-md border border-border p-2">
                      <span className="text-sm font-medium">
                        {section.from} → {section.to}
                      </span>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        <label className="block text-xs">
                          <span className="text-muted-foreground">R (Ω, per phase)</span>
                          <Input
                            type="number"
                            step="0.01"
                            value={section.resistanceOhm}
                            onChange={(event) => updateFeederSection(index, { resistanceOhm: Number(event.target.value) })}
                            aria-label={`Resistance of ${section.id}`}
                            className="h-8"
                          />
                        </label>
                        <label className="block text-xs">
                          <span className="text-muted-foreground">X (Ω, per phase)</span>
                          <Input
                            type="number"
                            step="0.01"
                            value={section.reactanceOhm}
                            onChange={(event) => updateFeederSection(index, { reactanceOhm: Number(event.target.value) })}
                            aria-label={`Reactance of ${section.id}`}
                            className="h-8"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <div
                role="status"
                className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                  distribution.error || (feederResult && !feederResult.converged)
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {distribution.error || (feederResult && !feederResult.converged) ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span>
                  {distribution.error
                    ? `The feeder cannot be solved: ${distribution.error}`
                    : feederResult && !feederResult.converged
                      ? `The feeder did not converge after ${feederResult.iterations} backward/forward sweeps. Values below are the last sweep, not a solution.`
                      : feederResult
                        ? `Feeder converged in ${feederResult.iterations} backward/forward sweep${feederResult.iterations === 1 ? '' : 's'}.`
                        : 'Waiting for a feeder.'}
                </span>
              </div>

              {feederResult && (
                <>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Kpi label="Source delivered" value={`${fmt(feederResult.sourceDeliveredKw, 2)} kW`} detail={`${fmt(feederResult.sourceDeliveredKvar, 2)} kvar`} />
                    <Kpi label="Demand" value={`${fmt(feederResult.totalLoadKw, 2)} kW`} detail={`${fmt(feederResult.totalLoadKvar, 2)} kvar`} />
                    <Kpi label="Copper loss" value={`${fmt(feederResult.totalLossKw, 3)} kW`} detail={`${fmt(feederResult.totalLossKvar, 3)} kvar`} />
                    <Kpi label="Minimum voltage" value={`${fmt(feederResult.minVoltagePu, 4)} pu`} detail={`worst node: ${feederResult.worstNodeId}`} />
                    <Kpi label="Local generation" value={`${fmt(feederResult.totalGenerationKw, 2)} kW`} detail="negative demand at its node" />
                    <Kpi label="Sweeps" value={String(feederResult.iterations)} detail={feederResult.converged ? 'converged' : 'stopped without a solution'} />
                  </div>

                  {feederWarnings.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">What the solve flags</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {feederWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Node voltages</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-sm">
                        <caption className="sr-only">Feeder node voltages and drops</caption>
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th scope="col" className="py-2 pr-3">Node</th>
                            <th scope="col" className="py-2 pr-3 text-right">V phase (V)</th>
                            <th scope="col" className="py-2 pr-3 text-right">V (pu)</th>
                            <th scope="col" className="py-2 pr-3 text-right">Drop (%)</th>
                            <th scope="col" className="py-2 text-right">Angle (°)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {feederResult.nodes.map((node) => (
                            <tr key={node.id} className="border-b border-border/60 last:border-0">
                              <td className="py-1.5 pr-3 font-medium">{node.id}</td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(node.voltageV, 1)}</td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(node.voltagePu, 4)}</td>
                              <td
                                className={`cad-readout py-1.5 pr-3 text-right ${node.dropPercent > 6 ? 'text-destructive' : ''}`}
                              >
                                {fmt(node.dropPercent, 2)}
                              </td>
                              <td className="cad-readout py-1.5 text-right">{fmt(node.angleDeg, 2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Section currents and losses</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-sm">
                        <caption className="sr-only">Feeder section currents, losses and voltage drop</caption>
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th scope="col" className="py-2 pr-3">Section</th>
                            <th scope="col" className="py-2 pr-3 text-right">Current (A)</th>
                            <th scope="col" className="py-2 pr-3 text-right">Loss (kW)</th>
                            <th scope="col" className="py-2 text-right">Drop (%)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {feederResult.sections.map((section) => (
                            <tr key={section.id} className="border-b border-border/60 last:border-0">
                              <td className="py-1.5 pr-3 font-medium">
                                {section.from} → {section.to}
                              </td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(section.currentA, 1)}</td>
                              <td className="cad-readout py-1.5 pr-3 text-right">{fmt(section.lossKw, 3)}</td>
                              <td className="cad-readout py-1.5 text-right">{fmt(section.dropPercent, 2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                </>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Model basis and limits</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    Backward/forward sweep on a radial tree, per phase, with three-phase constant-power loads divided
                    evenly across the phases. Currents accumulate from the leaves; voltages update from the source.
                  </p>
                  <p>
                    No shunt capacitance, line charging, voltage regulators, unbalanced phases, fault behaviour,
                    conductor temperature or protection. A loop or a second parent is refused rather than approximated.
                    Loads are constant power, so a heavily loaded feeder can fail to converge instead of showing an
                    invented voltage.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
