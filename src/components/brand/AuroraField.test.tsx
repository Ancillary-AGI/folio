/**
 * The ambient field as the shell meets it.
 *
 * A test environment has no WebGL, so these cases are exactly the ones that
 * matter: the field must still paint a background, must hold the document
 * attribute that the chrome's translucency depends on, and must get out of the
 * way completely when the theme or the user says it should not be there.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AuroraField } from './AuroraField'
import { useAppStore } from '../../stores/useAppStore'
import { DEFAULT_SETTINGS } from '../../lib/settings/registry'

const setting = () => useAppStore.getState().settings

describe('AuroraField', () => {
  beforeEach(() => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    document.documentElement.removeAttribute('data-aurora')
  })

  it('paints a non-interactive background and claims the chrome translucency', () => {
    const { container } = render(<AuroraField accentToken="--chart-2" />)
    const field = container.querySelector('.folio-aurora')
    expect(field).not.toBeNull()
    expect(field?.getAttribute('aria-hidden')).toBe('true')
    expect(field?.querySelector('canvas')).not.toBeNull()
    expect(document.documentElement.dataset.aurora).toBe('on')
  })

  it('falls back to CSS tints where there is no WebGL context', () => {
    const { container } = render(<AuroraField />)
    // jsdom cannot hand back a context; the shell must still not be flat.
    expect(container.querySelector('.folio-aurora')?.getAttribute('data-engine')).toBe('css')
  })

  it('leaves the document alone when the switch is off', () => {
    useAppStore.setState({ settings: { ...setting(), ambientLight: false } })
    const { container } = render(<AuroraField accentToken="--chart-1" />)
    expect(container.querySelector('.folio-aurora')).toBeNull()
    expect(document.documentElement.hasAttribute('data-aurora')).toBe(false)
  })

  it('never lights the high-contrast theme', () => {
    useAppStore.setState({ settings: { ...setting(), theme: 'high-contrast' } })
    const { container } = render(<AuroraField accentToken="--chart-3" />)
    expect(container.querySelector('.folio-aurora')).toBeNull()
    expect(document.documentElement.hasAttribute('data-aurora')).toBe(false)
  })

  it('releases the attribute when it unmounts', () => {
    const { unmount } = render(<AuroraField />)
    expect(document.documentElement.dataset.aurora).toBe('on')
    unmount()
    expect(document.documentElement.hasAttribute('data-aurora')).toBe(false)
  })
})
