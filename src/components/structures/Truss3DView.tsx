/**
 * The structures 3D viewport: the same lattice the sheet draws, stood up in space.
 *
 * A planar truss is drawn in 2D and built in 3D. This is the view that answers
 * the questions a flat diagram cannot: does the web member clear the bottom
 * chord, how deep is the frame against its span, where does a bearing actually
 * sit. Bars are cylinders of the section's real radius, joints are spheres, and
 * compressed bars take the same cool hue as the sheet so the two readings cannot
 * disagree about which member is doing the work.
 *
 * Shading follows the app-wide preference like every other viewport: solid for
 * appearance, outline for geometry. The outline pass walks whatever this JSX
 * builds, so it never mutates a material this component does not own.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useTheme } from '../../lib/theme/useTheme'
import { THEMES, hslTripletToRgb, rgbToHex } from '../../lib/theme/tokens'
import { setShadingMode } from '../../lib/3d/outline'
import type { TrussModel, TrussNode, TrussResult } from '../../lib/structures/truss'

interface Truss3DViewProps {
  model: TrussModel
  result: TrussResult | null
  /** Same exaggeration the sheet uses, so both readings show the same shape. */
  deflectionScale: number
  showDeflected: boolean
  shading: 'solid' | 'outline'
}

/** A bar's radius from its area: a circular section of the area the model declares. */
function barRadius(area: number): number {
  return Math.max(1e-3, Math.sqrt(area / Math.PI))
}

/**
 * One straight member. `quaternion` turns the cylinder's local +Y — the axis a
 * `cylinderGeometry` is built along — onto the bar direction, so a vertical post
 * and a 30° diagonal share this component.
 */
function Bar({
  from,
  to,
  radius,
  color,
  opacity = 1,
}: {
  from: TrussNode
  to: TrussNode
  radius: number
  color: string
  opacity?: number
}) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(from.x, from.y, 0)
    const b = new THREE.Vector3(to.x, to.y, 0)
    const direction = b.clone().sub(a)
    const span = direction.length()
    const axis = span > 1e-9 ? direction.clone().normalize() : new THREE.Vector3(0, 1, 0)
    return {
      position: a.clone().add(b).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis),
      length: Math.max(span, 1e-4),
    }
  }, [from, to])

  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 18]} />
      <meshStandardMaterial
        color={color}
        metalness={0.7}
        roughness={0.35}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  )
}

export default function Truss3DView({
  model,
  result,
  deflectionScale,
  showDeflected,
  shading,
}: Truss3DViewProps) {
  const { theme } = useTheme()
  const frameRef = useRef<THREE.Group>(null)

  const palette = useMemo(() => {
    const hex = (token: string) => rgbToHex(hslTripletToRgb(THEMES[theme][token]))
    return {
      tension: hex('--force-tension'),
      compression: hex('--force-compression'),
      neutral: hex('--force-neutral'),
      joint: hex('--foreground'),
      bearing: hex('--warning'),
      load: hex('--canvas-warning'),
      background: hex('--canvas'),
      grid: hex('--grid-major'),
    }
  }, [theme])

  const nodeById = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model.nodes])

  const bounds = useMemo(() => {
    if (model.nodes.length === 0) return { center: new THREE.Vector3(), radius: 1 }
    const points = model.nodes.map((node) => new THREE.Vector3(node.x, node.y, 0))
    const box = new THREE.Box3().setFromPoints(points)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    return { center, radius: Math.max(0.5, size.length() / 2) }
  }, [model.nodes])

  /*
   * The outline pass needs a real THREE subtree, which this JSX only becomes once
   * the fiber reconciler has run, so it is applied in an effect rather than during
   * render. It is idempotent in both directions: re-running it on every edit costs
   * a traversal and cannot stack a second crease wire on a bar.
   */
  useEffect(() => {
    setShadingMode(frameRef.current, shading)
  }, [shading, model, result])

  const deflected = (node: TrussNode): [number, number, number] => {
    const move = result?.displacements[node.id]
    return [node.x + (move?.x ?? 0) * deflectionScale, node.y + (move?.y ?? 0) * deflectionScale, 0]
  }

  const colourOf = (memberId: string): string => {
    const demand = result?.members[memberId]
    if (!demand) return palette.neutral
    if (demand.force > 0) return palette.tension
    if (demand.force < 0) return palette.compression
    return palette.neutral
  }

  return (
    <Canvas
      camera={{ position: [bounds.center.x, bounds.center.y + bounds.radius * 0.2, bounds.radius * 2.6], fov: 45 }}
      style={{ background: palette.background }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[bounds.center.x + 4, bounds.center.y + 8, 8]} intensity={1.1} />
      <directionalLight position={[bounds.center.x - 6, bounds.center.y - 2, -4]} intensity={0.35} />

      <group ref={frameRef}>
        {model.members.map((member) => {
          const a = nodeById.get(member.from)
          const b = nodeById.get(member.to)
          if (!a || !b) return null
          const radius = barRadius(member.area)
          return (
            <Bar key={member.id} from={a} to={b} radius={radius} color={colourOf(member.id)} />
          )
        })}

        {showDeflected && result && (
          <group>
            {model.members.map((member) => {
              const a = nodeById.get(member.from)
              const b = nodeById.get(member.to)
              if (!a || !b) return null
              const [ax, ay] = deflected(a)
              const [bx, by] = deflected(b)
              return (
                <Bar
                  key={`deflected-${member.id}`}
                  from={{ id: a.id, x: ax, y: ay }}
                  to={{ id: b.id, x: bx, y: by }}
                  radius={barRadius(member.area) * 0.4}
                  color={palette.load}
                  opacity={0.75}
                />
              )
            })}
          </group>
        )}

        {model.nodes.map((node) => (
          <mesh key={node.id} position={[node.x, node.y, 0]}>
            <sphereGeometry args={[Math.max(0.02, bounds.radius * 0.02), 20, 16]} />
            <meshStandardMaterial color={palette.joint} metalness={0.5} roughness={0.4} />
          </mesh>
        ))}

        {model.supports.map((support) => {
          const node = nodeById.get(support.node)
          if (!node) return null
          // A bearing is drawn as the cone a drafter sketches: apex at the joint,
          // base on the ground for a vertical restraint, turned on its side when
          // only the horizontal axis is held.
          const rotated = support.holdsX && !support.holdsY
          return (
            <group
              key={`bearing-${support.node}`}
              position={[node.x, node.y, 0]}
              rotation={[0, 0, rotated ? Math.PI / 2 : 0]}
            >
              <mesh position={[0, -0.16, 0]}>
                <coneGeometry args={[0.13, 0.26, 24]} />
                <meshStandardMaterial color={palette.bearing} metalness={0.3} roughness={0.6} />
              </mesh>
              <mesh position={[0, -0.32, 0]}>
                <boxGeometry args={[0.34, 0.04, 0.2]} />
                <meshStandardMaterial color={palette.bearing} metalness={0.3} roughness={0.6} />
              </mesh>
            </group>
          )
        })}

        {model.loads.map((load) => {
          const node = nodeById.get(load.node)
          if (!node) return null
          const magnitude = Math.hypot(load.fx, load.fy)
          if (magnitude < 1e-9) return null
          const direction = new THREE.Vector3(load.fx, load.fy, 0).normalize()
          return (
            <arrowHelper
              key={`load-${load.node}`}
              args={[direction, new THREE.Vector3(node.x, node.y, 0), bounds.radius * 0.35, palette.load, bounds.radius * 0.1, bounds.radius * 0.06]}
            />
          )
        })}
      </group>

      <gridHelper
        args={[bounds.radius * 4, Math.max(8, Math.round(bounds.radius * 4)), palette.grid, palette.grid]}
        position={[bounds.center.x, bounds.center.y - bounds.radius * 1.15, 0]}
      />

      <OrbitControls target={[bounds.center.x, bounds.center.y, 0]} enablePan enableZoom enableRotate />
    </Canvas>
  )
}
