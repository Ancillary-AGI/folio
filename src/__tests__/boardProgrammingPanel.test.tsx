import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import BoardProgrammingPanel from '../components/programming/BoardProgrammingPanel'
import { useProjectStore, type CanvasComponent, type CanvasWire } from '../stores/useProjectStore'
import type { Component } from '../lib/supabase'

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
