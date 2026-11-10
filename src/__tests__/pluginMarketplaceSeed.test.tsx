/**
 * Plugin marketplace seeding.
 *
 * Built-in packages are registered at module load, before any component exists,
 * so a registry refusal used to reach only the console: the card still rendered
 * as an installable listing, and the Install button failed with no explanation
 * anywhere. The service is faked here to force one refusal.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

type FakePackage = { manifest: { permissions: string[] }; packagePayload: { tools: unknown[] } }

const mocks = vi.hoisted(() => ({
  packages: new Map<string, FakePackage>(),
  installed: new Set<string>(),
}))

vi.mock('../lib/marketplace/marketplaceService', () => ({
  marketplaceService: {
    registerPackage: (entry: { id: string } & FakePackage) => {
      if (entry.id === 'assembly-export') throw new Error('manifest rejected: unknown permission "fs:write"')
      mocks.packages.set(entry.id, entry)
    },
    getPackage: (id: string) => mocks.packages.get(id),
    listPackages: () => [...mocks.packages.values()],
    isInstalled: (id: string) => mocks.installed.has(id),
    installPackage: (id: string) => {
      const entry = mocks.packages.get(id)
      if (!entry) throw new Error(`"${id}" is not in the local registry`)
      mocks.installed.add(id)
      return { declaredToolCount: entry.packagePayload.tools.length }
    },
    uninstallPackage: (id: string) => mocks.installed.delete(id),
    listInstalled: () => [...mocks.installed].map((id) => mocks.packages.get(id)!),
  },
}))

// Imported after the fake is in place, so the module-scope seed uses it.
const { default: PluginMarketplace } = await import('../components/ecad/PluginMarketplace')

/* A featured package renders its name twice — in the featured strip and in the
 * listing row — so look at every match and take the one whose card carries the
 * Install control. */
const installButton = (pluginName: string): HTMLButtonElement => {
  for (const name of screen.getAllByText(pluginName)) {
    let node: HTMLElement | null = name.parentElement
    while (node && !Array.from(node.querySelectorAll('button')).some((b) => /install/i.test(b.textContent ?? ''))) {
      node = node.parentElement
    }
    const button = node && Array.from(node.querySelectorAll('button')).find((b) => /install/i.test(b.textContent ?? ''))
    if (button instanceof HTMLButtonElement) return button
  }
  throw new Error(`"${pluginName}" has no Install control in its row`)
}

describe('PluginMarketplace registry seeding', () => {
  it('names the package the registry refused instead of failing silently', () => {
    render(<PluginMarketplace onClose={() => {}} />)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Assembly Package Export')
    expect(alert.textContent).toContain('manifest rejected: unknown permission "fs:write"')
    // The refusal is contained: the sibling packages still registered, and the
    // panel renders around the failure instead of blanking.
    expect(mocks.packages.has('klayout-drc')).toBe(true)
    expect(installButton('Assembly Package Export').textContent).toContain('Install')
  })

  it('reports the refusal when the affected Install button is pressed', () => {
    render(<PluginMarketplace onClose={() => {}} />)

    fireEvent.click(installButton('Assembly Package Export'))

    expect(
      screen.getAllByRole('alert').some((node) => /not in the local registry/.test(node.textContent ?? '')),
    ).toBe(true)
  })
})
