/**
 * AdvancedRoboticsPanel render coverage.
 *
 * WebGL cannot run in jsdom, so the fiber Canvas and drei helpers are stubbed
 * at the module boundary; the kinematics, dynamics and planning behind every
 * button below them runs for real. These tests pin the panel's honesty: the
 * Results card must always describe the pose the arm is actually in.
 */
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AdvancedRoboticsPanel } from '../components/robotics/AdvancedRoboticsPanel'

vi.mock('@react-three/fiber', () => {
  const state = {
    camera: {
      position: { set: () => {}, copy: () => ({ addScaledVector: () => {} }), addScaledVector: () => {} },
      lookAt: () => {},
      updateProjectionMatrix: () => {},
    },
    controls: null,
    size: { width: 800, height: 600 },
  }
  return {
    // The scene graph is three.js intrinsics with no DOM equivalent; the panel's
    // control surface is what these tests cover, so the Canvas renders empty.
    Canvas: React.forwardRef(() => <div data-testid="r3f-canvas" />),
    useFrame: () => {},
    useThree: (selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state),
  }
})

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  Grid: () => null,
  GizmoHelper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  GizmoViewport: () => null,
  Line: () => null,
}))

/** The value shown beside a label in the Results card, or null when absent. */
const resultValue = (label: string): string | null => {
  const node = screen.queryByText(label)
  if (!node) return null
  return node.parentElement?.textContent?.replace(label, '') ?? null
}

/** The pose string the card currently reports. */
const reportedJoints = (): string => resultValue('Joints') ?? ''

describe('AdvancedRoboticsPanel', () => {
  const loadDemo = () => {
    render(<AdvancedRoboticsPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Load 2-link demo (FK + STEP)' }))
    expect(screen.getByText('Shoulder')).toBeInTheDocument()
    expect(screen.getByText('Elbow')).toBeInTheDocument()
  }

  it('reports the live pose before anything is run', () => {
    loadDemo()

    // The zero pose: 120 + 100 mm of chain out from the 50 mm base.
    expect(resultValue('Current pose')).toBe('(0.220, 0.050, 0.000)')
    expect(reportedJoints()).toBe('0.0° 0.0°')
  })

  it('moves the Results readout to the inverse-kinematics solution', () => {
    loadDemo()

    fireEvent.click(screen.getByRole('button', { name: 'Forward Kinematics' }))
    expect(screen.getByRole('status')).toHaveTextContent('Tool point at (0.220, 0.050, 0.000)')

    fireEvent.click(screen.getByRole('button', { name: 'Compute Dynamics' }))
    expect(screen.getByText('Total energy')).toBeInTheDocument()

    // The demo loads the target the planar arm can actually reach.
    expect(screen.getByLabelText('Target X')).toHaveValue(0.18)
    expect(screen.getByLabelText('Target Z')).toHaveValue(0)
    fireEvent.click(screen.getByRole('button', { name: 'Inverse Kinematics' }))

    // The solver answered, and the card now quotes the same numbers it solved to.
    const solved = (screen.getByRole('status').textContent ?? '')
      .replace('IK solved: ', '')
      .replace(', ', ' ')
    expect(solved).toMatch(/^-?\d+\.\d+° -?\d+\.\d+°$/)
    expect(reportedJoints()).toBe(solved)
    expect(resultValue('Current pose')).not.toBe('(0.220, 0.050, 0.000)')
    // The pose the card reports is the one the target asked for, inside the
    // solver's own tolerance.
    const [poseX, poseY] = (resultValue('Current pose') ?? '')
      .replace(/[()]/g, '')
      .split(', ')
      .map(Number)
    expect(poseX).toBeCloseTo(0.18, 2)
    expect(poseY).toBeCloseTo(0.11, 2)
    // A new pose invalidates the dynamics computed for the old one.
    expect(screen.queryByText('Total energy')).not.toBeInTheDocument()
  })

  it('names the distance an unreachable target falls short by', () => {
    loadDemo()

    // A planar arm with z-axis joints cannot leave its plane.
    fireEvent.change(screen.getByLabelText('Target Z'), { target: { value: '0.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Inverse Kinematics' }))

    expect(screen.getByRole('status')).toHaveTextContent(
      /did not converge — the tool stops \d+\.\d+ m short of \(0\.180, 0\.110, 0\.200\)/,
    )
    // The failed solve leaves the reported pose alone: nothing is applied.
    expect(reportedJoints()).toBe('0.0° 0.0°')
    expect(resultValue('Current pose')).toBe('(0.220, 0.050, 0.000)')
  })

  it('follows a joint slider and drops the results computed for the previous pose', () => {
    loadDemo()

    fireEvent.click(screen.getByRole('button', { name: 'Compute Dynamics' }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan Trajectory' }))
    expect(screen.getByText('Total energy')).toBeInTheDocument()
    expect(screen.getByText('Waypoints')).toBeInTheDocument()

    // Named by its label, so this also proves the joint slider is announced as
    // "Shoulder". The value is set with `change` rather than a key press because
    // jsdom has no native range-input keyboard handling — in a browser
    // ArrowRight is what fires this event.
    const shoulder = screen.getByRole('slider', { name: 'Shoulder' })
    fireEvent.change(shoulder, { target: { value: '1' } })

    expect(reportedJoints()).toBe('1.0° 0.0°')
    expect(screen.queryByText('Total energy')).not.toBeInTheDocument()
    expect(screen.queryByText('Waypoints')).not.toBeInTheDocument()
    // The pose the card reports is the one the solver was handed.
    expect(resultValue('Current pose')).not.toBe('(0.220, 0.050, 0.000)')
  })
})
