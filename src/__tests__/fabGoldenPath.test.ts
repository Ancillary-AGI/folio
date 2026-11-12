/**
 * The golden path, proven end to end with the real engines — the exact flow
 * the PCB panel drives when a user presses "Fab package":
 *
 *   demo netlist → routed copper (real A* autorouter) → DRC-gated fab package
 *   → stored ZIP archive → byte-verified CRCs → the fab-deliverable invariant
 *
 * If any link in that chain silently degrades, this test fails loudly rather
 * than shipping a board a fab house refuses.
 */
import { describe, expect, it } from 'vitest'
import { buildDemoBoard } from '../lib/demo/demoBoard'
import { buildDemoPcb } from '../lib/demo/demoPcb'
import { buildFabPackage } from '../lib/manufacturing/fabExport'
import { fabCopperFromRoutedTraces, netsFromWires, placeFromRoutedLayout } from '../lib/pcb/boardLayout'
import { createTextZipBytes, crc32 } from '../lib/manufacturing/zipStore'

const readUInt16 = (view: DataView, offset: number) => view.getUint16(offset, true)
const readUInt32 = (view: DataView, offset: number) => view.getUint32(offset, true)
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL = 0x06054b50

function walkEntries(bytes: Uint8Array) {
  const data = view(bytes)
  const names: string[] = []
  let offset = 0
  while (readUInt32(data, offset) === LOCAL_HEADER) {
    const nameLength = readUInt16(data, offset + 26)
    const size = readUInt32(data, offset + 18)
    const crc = readUInt32(data, offset + 14)
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
    const dataStart = offset + 30 + nameLength
    expect(crc).toBe(crc32(bytes.subarray(dataStart, dataStart + size)))
    names.push(name)
    offset = dataStart + size
  }
  // Skip the central directory: one 46-byte record per entry, then the EOCD.
  expect(readUInt32(data, offset)).toBe(CENTRAL_HEADER)
  while (readUInt32(data, offset) === CENTRAL_HEADER) {
    const nameLength = readUInt16(data, offset + 28)
    const extraLength = readUInt16(data, offset + 30)
    const commentLength = readUInt16(data, offset + 32)
    offset += 46 + nameLength + extraLength + commentLength
  }
  expect(readUInt32(data, offset)).toBe(END_OF_CENTRAL)
  return names
}

describe('the demo rectifier → fab package → zip golden path', () => {
  it('routes every net, produces a shippable package and emits a verifiable archive', () => {
    const demo = buildDemoPcb()
    expect(demo.summary.unrouted).toEqual([])
    expect(demo.summary.routedNets).toBeGreaterThan(0)

    const board = buildDemoBoard()
    const placement = placeFromRoutedLayout(board.components, demo.scene)
    const pkg = buildFabPackage(
      placement.components,
      fabCopperFromRoutedTraces(
        demo.traces.map((trace) => ({
          id: trace.id,
          points: trace.points,
          width: trace.widthMm,
          netName: trace.net,
          layerId: trace.layerId,
        })),
      ),
      {
        projectName: 'folio-rectifier',
        boardWidth: demo.board.widthMm,
        boardHeight: demo.board.heightMm,
        innerLayerCount: 2,
        nets: netsFromWires(board.wires),
        planes: [],
        vias: demo.vias.map((via) => ({
          x: via.x,
          y: via.y,
          drillDiameter: via.drillMm,
          padDiameter: via.padMm,
          netName: via.net,
        })),
      },
    )

    // The DRC gate must clear a routed demo board, or fab hand-off is a lie.
    expect(pkg.violations.filter((violation) => violation.severity === 'error')).toEqual([])
    expect(pkg.shippable).toBe(true)

    const names = [...pkg.files.keys()]
    for (const expected of [
      'folio-rectifier-F_Cu.gtl',
      'folio-rectifier-B_Cu.gbl',
      'folio-rectifier-F_Silk.gto',
      'folio-rectifier-Edge_Cuts.gm1',
      'folio-rectifier.drl',
      'folio-rectifier-centroid.csv',
      'folio-rectifier-bom.csv',
    ]) {
      expect(names).toContain(expected)
    }

    const archive = createTextZipBytes(pkg.files, new Date(2026, 10, 11))
    expect(walkEntries(archive).sort()).toEqual([...names].sort())
  })
})
