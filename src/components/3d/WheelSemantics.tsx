import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

/**
 * Wheel semantics for the 3D CAD views, matching the schematic and the charts:
 * a plain wheel belongs to the page (scroll the panel), only pinch
 * (ctrl/meta+wheel) may dolly the camera. Registered capture-phase before the
 * OrbitControls' own wheel listener, so the controls never see a plain wheel
 * and the page under the canvas keeps scrolling natively.
 */
export default function WheelSemantics() {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    const node = gl.domElement
    const onWheel = (event: WheelEvent) => {
      // Pinch arrives as ctrl/meta+wheel; let the controls handle it untouched.
      if (event.ctrlKey || event.metaKey) return
      // Otherwise the controls must not dolly and the default (page scroll)
      // must survive: stop the controls, keep the page.
      event.stopImmediatePropagation()
    }
    node.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => node.removeEventListener('wheel', onWheel, true)
  }, [gl])

  return null
}
