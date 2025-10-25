// Export utilities for Circuit CAD Pro
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

export function exportToSVG(
  components: PlacedComponent[], 
  wires: Wire[], 
  options: Partial<ExportOptions> = {}
): string {
  const { includeGrid = false, colorScheme = 'color' } = options
  
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <style>
      .component { fill: ${colorScheme === 'color' ? '#2563eb' : '#000'}; stroke: #000; stroke-width: 1; }
      .wire { stroke: ${colorScheme === 'color' ? '#059669' : '#000'}; stroke-width: 2; fill: none; }
      .pin { fill: ${colorScheme === 'color' ? '#dc2626' : '#000'}; r: 2; }
      .text { font-family: Arial, sans-serif; font-size: 12px; fill: #000; }
      .grid { stroke: #e5e7eb; stroke-width: 0.5; }
    </style>
  </defs>
`

  // Add grid if requested
  if (includeGrid) {
    svg += '  <g class="grid-layer">\n'
    for (let x = 0; x <= 800; x += 10) {
      svg += `    <line x1="${x}" y1="0" x2="${x}" y2="600" class="grid"/>\n`
    }
    for (let y = 0; y <= 600; y += 10) {
      svg += `    <line x1="0" y1="${y}" x2="800" y2="${y}" class="grid"/>\n`
    }
    svg += '  </g>\n'
  }

  // Add wires
  svg += '  <g class="wires-layer">\n'
  wires.forEach(wire => {
    if (wire.points.length >= 2) {
      const pathData = wire.points.map((point, index) => 
        `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
      ).join(' ')
      svg += `    <path d="${pathData}" class="wire"/>\n`
    }
  })
  svg += '  </g>\n'

  // Add components
  svg += '  <g class="components-layer">\n'
  components.forEach(comp => {
    svg += `    <g transform="translate(${comp.position.x}, ${comp.position.y}) rotate(${comp.rotation})">\n`
    
    // Draw component symbol
    comp.component.symbol.paths.forEach(path => {
      svg += `      <path d="${path}" class="component"/>\n`
    })
    
    // Draw pins
    comp.component.pins.forEach(pin => {
      svg += `      <circle cx="${pin.x}" cy="${pin.y}" class="pin"/>\n`
    })
    
    // Add reference text
    svg += `      <text x="0" y="-5" class="text">${comp.reference}</text>\n`
    
    svg += '    </g>\n'
  })
  svg += '  </g>\n'

  svg += '</svg>'
  return svg
}

export function exportToNetlist(
  components: PlacedComponent[], 
  wires: Wire[], 
  projectName: string
): string {
  let netlist = `* ${projectName} Netlist\n`
  netlist += `* Generated on ${new Date().toISOString()}\n`
  netlist += `* Circuit CAD Pro v1.0.0\n\n`
  
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
      generator: 'Circuit CAD Pro'
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

export function exportToGerber(
  components: PlacedComponent[], 
  wires: Wire[]
): string {
  // Basic Gerber export (simplified)
  let gerber = 'G04 Generated by Circuit CAD Pro*\n'
  gerber += 'G04 Gerber Format: RS-274X*\n'
  gerber += '%FSLAX36Y36*%\n'
  gerber += '%MOMM*%\n'
  gerber += '%TA.AperFunction,Conductor*%\n'
  
  // Define apertures
  gerber += '%ADD10C,0.1524*%\n' // Via
  gerber += '%ADD11C,0.2032*%\n' // Trace
  gerber += '%ADD12R,1.2700X1.2700*%\n' // Pad
  
  // Draw traces
  gerber += 'G01*\n'
  gerber += 'D11*\n'
  
  wires.forEach(wire => {
    if (wire.points.length >= 2) {
      gerber += `X${Math.round(wire.points[0].x * 1000)}Y${Math.round(wire.points[0].y * 1000)}D02*\n`
      for (let i = 1; i < wire.points.length; i++) {
        gerber += `X${Math.round(wire.points[i].x * 1000)}Y${Math.round(wire.points[i].y * 1000)}D01*\n`
      }
    }
  })
  
  // Draw component pads
  gerber += 'D12*\n'
  components.forEach(comp => {
    comp.component.pins.forEach(pin => {
      const x = comp.position.x + pin.x
      const y = comp.position.y + pin.y
      gerber += `X${Math.round(x * 1000)}Y${Math.round(y * 1000)}D03*\n`
    })
  })
  
  gerber += 'M02*\n'
  return gerber
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

export function exportProject(
  components: PlacedComponent[],
  wires: Wire[],
  projectName: string,
  format: ExportOptions['format'],
  options: Partial<ExportOptions> = {}
): string {
  switch (format) {
    case 'json':
      return exportToJSON(components, wires, projectName)
    case 'netlist':
      return exportToNetlist(components, wires, projectName)
    case 'bom':
      return exportToBOM(components)
    case 'svg':
      return exportToSVG(components, wires, options)
    case 'gerber':
      return exportToGerber(components, wires)
    default:
      throw new Error(`Unsupported export format: ${format}`)
  }
}