// Export utilities for Folio
import { PlacedComponent, Wire, SimulationResult } from '../types'

export interface ExportOptions {
  format: 'png' | 'svg' | 'pdf' | 'netlist' | 'json' | 'gerber' | 'bom'
  resolution?: number
  includeGrid?: boolean
  includeAnnotations?: boolean
  colorScheme?: 'color' | 'monochrome'
  paperSize?: 'A4' | 'A3' | 'Letter' | 'Legal'
  orientation?: 'portrait' | 'landscape'
}

export function exportToImage(
  canvas: HTMLCanvasElement, 
  options: Partial<ExportOptions> = {}
): string {
  const { resolution = 1, colorScheme = 'color' } = options
  
  // Create a temporary canvas for export
  const exportCanvas = document.createElement('canvas')
  const ctx = exportCanvas.getContext('2d')!
  
  exportCanvas.width = canvas.width * resolution
  exportCanvas.height = canvas.height * resolution
  
  ctx.scale(resolution, resolution)
  
  // Apply color scheme
  if (colorScheme === 'monochrome') {
    ctx.filter = 'grayscale(100%)'
  }
  
  ctx.drawImage(canvas, 0, 0)
  
  return exportCanvas.toDataURL('image/png')
}

export function exportToNetlist(
  components: PlacedComponent[], 
  wires: Wire[], 
  projectName: string
): string {
  let netlist = `* ${projectName} Netlist\n`
  netlist += `* Generated on ${new Date().toISOString()}\n`
  netlist += `* Folio v2.0.0\n\n`
  
  // Create net mapping
  const netMap = new Map<string, string>()
  let netCounter = 1
  
  wires.forEach(wire => {
    if (wire.netName) {
      wire.connectedPins.forEach(pin => {
        const pinKey = `${pin.componentId}_${pin.pinId}`
        netMap.set(pinKey, wire.netName!)
      })
    } else {
      // Auto-generate net names
      const netName = `net${netCounter++}`
      wire.connectedPins.forEach(pin => {
        const pinKey = `${pin.componentId}_${pin.pinId}`
        netMap.set(pinKey, netName)
      })
    }
  })
  
  // Add components
  components.forEach(comp => {
    const nodes = comp.component.pins.map(pin => {
      const pinKey = `${comp.id}_${pin.id}`
      return netMap.get(pinKey) || '0'
    })
    
    // Generate SPICE line based on component type
    const compType = comp.component.name.toLowerCase()
    let spiceLine = ''
    
    if (compType.includes('resistor')) {
      spiceLine = `R${comp.reference} ${nodes.join(' ')} ${comp.properties.value || '1k'}`
    } else if (compType.includes('capacitor')) {
      spiceLine = `C${comp.reference} ${nodes.join(' ')} ${comp.properties.value || '1u'}`
    } else if (compType.includes('inductor')) {
      spiceLine = `L${comp.reference} ${nodes.join(' ')} ${comp.properties.value || '1m'}`
    } else if (compType.includes('voltage')) {
      spiceLine = `V${comp.reference} ${nodes.join(' ')} DC ${comp.properties.voltage || '5'}`
    } else if (compType.includes('current')) {
      spiceLine = `I${comp.reference} ${nodes.join(' ')} DC ${comp.properties.current || '1m'}`
    } else {
      spiceLine = `X${comp.reference} ${nodes.join(' ')} ${comp.component.name}`
    }
    
    netlist += spiceLine + '\n'
    
    // Add component parameters
    Object.entries(comp.properties).forEach(([key, value]) => {
      if (key !== 'value' && value) {
        netlist += `+ ${key}=${value}\n`
      }
    })
  })
  
  netlist += '\n.end\n'
  return netlist
}

export function exportToJSON(
  components: PlacedComponent[], 
  wires: Wire[], 
  projectName: string,
  simulationResults?: SimulationResult[]
): string {
  const data = {
    project: {
      name: projectName,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      generator: 'Folio'
    },
    schematic: {
      components: components.map(comp => ({
        id: comp.id,
        reference: comp.reference,
        component: comp.component.name,
        position: comp.position,
        rotation: comp.rotation,
        properties: comp.properties,
        pins: comp.component.pins
      })),
      wires: wires.map(wire => ({
        id: wire.id,
        points: wire.points,
        netName: wire.netName,
        connectedPins: wire.connectedPins
      }))
    },
    simulation: simulationResults ? {
      results: simulationResults,
      timestamp: new Date().toISOString()
    } : undefined,
    metadata: {
      componentCount: components.length,
      wireCount: wires.length,
      netCount: new Set(wires.map(w => w.netName).filter(Boolean)).size
    }
  }
  
  return JSON.stringify(data, null, 2)
}

export function exportToBOM(components: PlacedComponent[]): string {
  // Group components by type and value
  const bomMap = new Map<string, {
    references: string[]
    component: string
    value: string
    package: string
    description: string
    manufacturer?: string
    partNumber?: string
    cost?: number
  }>()
  
  components.forEach(comp => {
    const key = `${comp.component.name}_${comp.properties.value || 'N/A'}`
    
    if (bomMap.has(key)) {
      bomMap.get(key)!.references.push(comp.reference)
    } else {
      bomMap.set(key, {
        references: [comp.reference],
        component: comp.component.name,
        value: String(comp.properties.value || 'N/A'),
        package: String(comp.properties.package || 'N/A'),
        description: comp.component.description || 'N/A',
        manufacturer: String(comp.properties.manufacturer || ''),
        partNumber: String(comp.properties.partNumber || ''),
        cost: Number(comp.properties.cost) || 0
      })
    }
  })
  
  let bom = 'Bill of Materials\n'
  bom += '='.repeat(50) + '\n'
  bom += `Generated: ${new Date().toLocaleString()}\n`
  bom += `Total Components: ${components.length}\n`
  bom += `Unique Parts: ${bomMap.size}\n\n`
  
  bom += 'Item\tQty\tReferences\tValue\tPackage\tDescription\tManufacturer\tPart Number\tUnit Cost\tTotal Cost\n'
  bom += '-'.repeat(120) + '\n'
  
  let itemNumber = 1
  let totalCost = 0
  
  Array.from(bomMap.values()).forEach(item => {
    const qty = item.references.length
    const unitCost = item.cost || 0
    const lineCost = qty * unitCost
    totalCost += lineCost
    
    bom += `${itemNumber}\t${qty}\t${item.references.join(', ')}\t${item.value}\t${item.package}\t${item.description}\t${item.manufacturer}\t${item.partNumber}\t$${unitCost.toFixed(2)}\t$${lineCost.toFixed(2)}\n`
    itemNumber++
  })
  
  bom += '-'.repeat(120) + '\n'
  bom += `Total Estimated Cost: $${totalCost.toFixed(2)}\n`
  
  return bom
}

/**
 * Single-file RS-274X Gerber of the schematic copper and pads.
 *
 * Every length input is millimetres. Inch output converts lengths explicitly
 * and switches the format statement to `%FSLAX26Y26%` — a file whose header
 * claims 3.6 mm while its numbers are inch-scaled is silently misread by
 * every fabricator. `buildFabPackage` (manufacturing/fabExport) remains the
 * fab-grade path: separate copper/mask/silk layers, Excellon drill, centroid
 * and DRC. This one is the quick preview export.
 */
export function exportToGerber(
  components: PlacedComponent[],
  wires: Wire[],
  options: {
    boardWidth?: number
    boardHeight?: number
    traceWidth?: number
    units?: 'mm' | 'in'
  } = {}
): string {
  const {
    boardWidth = 100,
    boardHeight = 80,
    traceWidth = 0.2,
    units = 'mm',
  } = options

  // All values below are millimetres; convert once at the output boundary.
  const toUnit = (mm: number): number => (units === 'mm' ? mm : mm / 25.4)
  const coord = (mm: number): string => Math.round(toUnit(mm) * 1_000_000).toString()
  const aperture = (mm: number): string => toUnit(mm).toFixed(units === 'mm' ? 4 : 6)

  const lines: string[] = []

  // ── File header ───────────────────────────────────────────────────────────
  lines.push('G04 Generated by Folio*')
  lines.push('G04 Format: RS-274X (Extended Gerber)*')
  lines.push(`G04 Generated: ${new Date().toISOString()}*`)
  lines.push(units === 'mm' ? '%FSLAX36Y36*%' : '%FSLAX26Y26*%')  // 3.6 mm / 2.6 in
  lines.push(units === 'mm' ? '%MOMM*%' : '%MOIN*%')

  // ── Aperture definitions ──────────────────────────────────────────────────
  // D10 = standard trace width, D11 = via pad, D12 = rectangular SMD pad,
  // D13 = through-hole pad, D20 = outline hairline
  lines.push(`%ADD10C,${aperture(traceWidth)}*%`)
  lines.push(`%ADD11C,${aperture(0.6)}*%`)
  lines.push(`%ADD12R,${aperture(1.27)}X${aperture(1.27)}*%`)
  lines.push(`%ADD13C,${aperture(0.8)}*%`)
  lines.push(`%ADD20C,${aperture(0.05)}*%`)

  // ── Aperture attributes ───────────────────────────────────────────────────
  lines.push('%TA.AperFunction,Conductor*%')

  // ── Copper traces (from schematic wires) ─────────────────────────────────
  lines.push('G01*')   // linear interpolation
  lines.push('D10*')   // select trace aperture

  for (const wire of wires) {
    if (wire.points.length < 2) continue
    // Move to first point
    lines.push(`X${coord(wire.points[0].x)}Y${coord(wire.points[0].y)}D02*`)
    // Draw to each subsequent point
    for (let i = 1; i < wire.points.length; i++) {
      lines.push(`X${coord(wire.points[i].x)}Y${coord(wire.points[i].y)}D01*`)
    }
  }

  // ── Component pads ────────────────────────────────────────────────────────
  // Pins are symbol-local; place them at the component origin with its
  // rotation (and scale) applied, exactly as the canvas draws them.
  lines.push('D13*')   // through-hole pad aperture
  for (const comp of components) {
    const radians = (comp.rotation * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const scale = Number.isFinite(comp.scale) ? comp.scale : 1
    for (const pin of comp.component.pins) {
      const localX = pin.x * scale
      const localY = pin.y * scale
      const x = comp.position.x + localX * cos - localY * sin
      const y = comp.position.y + localX * sin + localY * cos
      lines.push(`X${coord(x)}Y${coord(y)}D03*`)
    }
  }

  // ── Board outline (Edge.Cuts equivalent) ─────────────────────────────────
  lines.push('G04 Board outline*')
  lines.push('D20*')  // thin hairline for outline
  // Rectangle outline
  const corners: [number, number][] = [
    [0, 0], [boardWidth, 0], [boardWidth, boardHeight], [0, boardHeight], [0, 0],
  ]
  lines.push(`X${coord(corners[0][0])}Y${coord(corners[0][1])}D02*`)
  for (let i = 1; i < corners.length; i++) {
    lines.push(`X${coord(corners[i][0])}Y${coord(corners[i][1])}D01*`)
  }

  // ── File end ──────────────────────────────────────────────────────────────
  lines.push('M02*')

  return lines.join('\n')
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}