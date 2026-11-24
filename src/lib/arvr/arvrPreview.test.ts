import { describe, expect, it } from 'vitest'
import { ARVRPreviewService } from './arvrPreview'

describe('ARVRPreviewService', () => {
  it('always supports orbit preview without WebXR', () => {
    const service = new ARVRPreviewService()
    const session = service.createSession('orbit')
    expect(session.supported).toBe(true)
    expect(session.tracking).toBe('none')
    expect(session.message).toContain('ready')
  })

  it('reports AR/VR unsupported without WebXR instead of pretending', () => {
    const service = new ARVRPreviewService()
    const session = service.createSession('vr')
    if (service.isWebXRAvailable()) return
    expect(session.supported).toBe(false)
    expect(session.tracking).toBe('orientation')
    expect(session.message).toContain('unavailable')
  })

  it('uses six-dof tracking and a wider FOV when WebXR exists', () => {
    const hadXR = 'xr' in navigator
    const original = (navigator as Navigator & { xr?: unknown }).xr
    Object.defineProperty(navigator, 'xr', { value: {}, configurable: true })
    try {
      const session = new ARVRPreviewService().createSession('vr')
      expect(session.supported).toBe(true)
      expect(session.tracking).toBe('six-dof')
      expect(session.camera.fov).toBe(90)
    } finally {
      if (hadXR) {
        Object.defineProperty(navigator, 'xr', { value: original, configurable: true })
      } else {
        delete (navigator as Navigator & { xr?: unknown }).xr
      }
    }
  })
})
