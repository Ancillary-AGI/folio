import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import BoardProgrammingPanel from '../components/programming/BoardProgrammingPanel'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore, type CanvasComponent, type CanvasWire } from '../stores/useProjectStore'
import type { Component } from '../lib/supabase'
import { dropLibraryItem } from './helpers/libraryDrop'
import { snippetCatalog } from '../lib/library/elementCatalogs'
import type { LibraryItem } from '../lib/library/types'

const libraryPart = (
  id: string,
  name: string,
  category: string,
  pins: Component['pins'],
): Component => ({
  id,
  name,
  category,
  is_standard: true,
  symbol_data: { width: 100, height: 100, paths: [] },
  pins,
  default_properties: {},
})

const placedPart = (id: string, reference: string, component: Component): CanvasComponent => ({
  id,
  componentId: component.id!,
  component,
  x: 0,
  y: 0,
  rotation: 0,
  reference,
  properties: {},
})

const mcuComponent = libraryPart('lib-mcu', 'Arduino Uno', 'microcontroller', [
  { id: 'd2', name: 'D2', x: 0, y: 0, type: 'io' },
])
const sensorComponent = libraryPart('lib-sensor', 'Temperature Sensor', 'sensor', [
  { id: 'out', name: 'OUT', x: 0, y: 0, type: 'output' },
])

describe('BoardProgrammingPanel schematic generation', () => {
  beforeEach(() => {
    useProjectStore.setState({ components: [], wires: [], firmwareCode: '' })
    useAppStore.setState({ demoRequest: null })
  })

  it('loads and analyses the demo firmware when the gallery requests it', async () => {
    useAppStore.setState({ demoRequest: 'embedded-rectifier' })

    render(<BoardProgrammingPanel onClose={() => {}} />)

    await waitFor(() => {
      const editor = screen.getByLabelText('Firmware source code') as HTMLTextAreaElement
      expect(editor.value).toContain('THRESHOLD_MV')
    })
    expect(await screen.findByText(/Static analysis passed/)).toBeInTheDocument()
    await waitFor(() => expect(useAppStore.getState().demoRequest).toBeNull())
  })

  it('generates a sketch from the schematic into the editor', async () => {
    const wires: CanvasWire[] = [{
      id: 'w1',
      points: [],
      netName: 'SENSE',
      connectedPins: [
        { componentId: 'mcu1', pinId: 'd2' },
        { componentId: 'sensor1', pinId: 'out' },
      ],
    }]
    useProjectStore.setState({
      components: [
        placedPart('mcu1', 'U1', mcuComponent),
        placedPart('sensor1', 'U2', sensorComponent),
      ],
      wires,
    })

    render(<BoardProgrammingPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Generate from schematic/ }))

    await waitFor(() => {
      const editor = screen.getByLabelText('Firmware source code') as HTMLTextAreaElement
      expect(editor.value).toContain('pinMode(D2, INPUT);')
      expect(editor.value).toContain('int U2Value = digitalRead(D2);')
    })
    expect(screen.getByRole('status')).toHaveTextContent(/Generated .* characters for Arduino Compiler/)
    expect(useProjectStore.getState().firmwareCode).toContain('pinMode(D2, INPUT);')
  })

  it('explains why an empty schematic cannot be compiled', async () => {
    render(<BoardProgrammingPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Generate from schematic/ }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/schematic is empty/)
    })
  })
})

/**
 * The sketch editor is a drop target for code rows: C/C++ lands at the caret,
 * and an HDL row is turned away with the reason instead of breaking the build.
 */
describe('BoardProgrammingPanel library drops', () => {
  const sketch = (): HTMLTextAreaElement => screen.getByLabelText('Firmware source code') as HTMLTextAreaElement

  const editorZone = (): HTMLElement => {
    const zone = sketch().closest('.cad-dropzone')
    if (!zone) throw new Error('the sketch editor is not a drop zone')
    return zone as HTMLElement
  }

  const snippetRow = (id: string): LibraryItem => {
    const row = snippetCatalog().find((item) => item.id === id)
    if (!row) throw new Error(`catalog row ${id} is gone`)
    return row
  }

  beforeEach(() => {
    localStorage.clear()
    useProjectStore.setState({ components: [], wires: [], firmwareCode: '', domainDesigns: {} })
    useAppStore.setState({ demoRequest: null, armedLibraryItem: null })
  })

  it('inserts a firmware row at the caret', () => {
    render(<BoardProgrammingPanel onClose={() => {}} />)

    const area = sketch()
    area.setSelectionRange(0, 0)
    dropLibraryItem(editorZone(), snippetRow('fw-arduino-blink'))

    expect(sketch().value.startsWith('// Turn an LED on PB5')).toBe(true)
    expect(screen.getByText(/"Arduino blink loop" inserted at the caret\./)).toBeInTheDocument()
    expect(useProjectStore.getState().firmwareCode).toContain('digitalWrite(13, HIGH)')
  })

  it('refuses HDL, which this board cannot compile', async () => {
    render(<BoardProgrammingPanel onClose={() => {}} />)

    const before = sketch().value
    dropLibraryItem(editorZone(), snippetRow('hdl-mux2'))

    expect(await screen.findByText(/is VERILOG HDL — the HDL editor takes it, not this firmware sketch\./)).toBeInTheDocument()
    expect(sketch().value).toBe(before)
  })

  it('spends an armed row through the Place button and disarms it', async () => {
    useAppStore.setState({ armedLibraryItem: snippetRow('fw-esp32-pwm') })

    render(<BoardProgrammingPanel onClose={() => {}} />)

    expect(await screen.findByText(/— drop it on the sketch or place it here\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Place' }))

    expect(await screen.findByText(/"ESP32 PWM fade" inserted at the caret\./)).toBeInTheDocument()
    expect(sketch().value).toContain('ledcAttachPin(PWM_PIN, 0)')
    expect(useAppStore.getState().armedLibraryItem).toBeNull()
  })
})
