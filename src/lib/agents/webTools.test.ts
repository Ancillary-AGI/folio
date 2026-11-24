/**
 * The research toolset, exercised through an injected fetcher — no network.
 * The fetcher is what the deployment provides; on the local backend it is
 * makeDefaultWebFetcher talking to /tools/fetch-text, on standalone builds
 * nothing is registered. Both properties are pinned here.
 */
import { describe, expect, it } from 'vitest'
import { AgentHarness } from './agentHarness'
import { createWebTools, makeDefaultWebFetcher, registerWebTools, type WebFetcher } from './webTools'
import { DEMO_DATASHEET_TEXT } from '../demo/demoDatasheet'

const stubFetcher: WebFetcher = async (url) => ({
  url,
  status: 200,
  contentType: 'text/plain; charset=utf-8',
  bytes: DEMO_DATASHEET_TEXT.length,
  truncated: false,
  text: DEMO_DATASHEET_TEXT,
})

const failingFetcher: WebFetcher = async () => {
  throw new Error('connection refused')
}

const web = createWebTools(stubFetcher)
const fetchTool = web.find((tool) => tool.name === 'web.fetch')
const datasheetTool = web.find((tool) => tool.name === 'web.datasheet')

describe('web research tools', () => {
  it('web.fetch returns the fetched page verbatim as bounded text', async () => {
    expect(fetchTool).toBeDefined()
    const result = await fetchTool!.handler({ url: 'https://example.com/ds.txt', maxBytes: 1024 }) as Record<string, unknown>
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(String(result.text)).toContain('MCP3008-I/SL')
    expect(result.bytes).toBe(String(result.text).length)
  })

  it('web.fetch surfaces fetch failure as a structured error, never an exception', async () => {
    const failing = createWebTools(failingFetcher).find((tool) => tool.name === 'web.fetch')!
    const result = await failing.handler({ url: 'https://example.com/' }) as Record<string, unknown>
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('connection refused')
  })

  it('web.datasheet parses the page and returns the extracted part profile', async () => {
    expect(datasheetTool).toBeDefined()
    const result = await datasheetTool!.handler({ url: 'https://example.com/ds.txt' }) as Record<string, unknown>
    expect(result.ok).toBe(true)
    expect(result.partNumber).toBe('MCP3008-I/SL')
    expect(result.manufacturer).toBe('Microchip Technology')
    const pins = result.pins as Array<{ number: number; name: string; kind: string }>
    expect(pins.length).toBeGreaterThanOrEqual(16)
    expect(pins.find((pin) => pin.name === 'VDD')?.kind).toBe('power')
    const packaging = result.packaging as { packageName: string; pinCount: number; packageStated: boolean }
    expect(packaging.pinCount).toBe(16)
    expect(packaging.packageStated).toBe(true)
  })

  it('web.datasheet marks an unstated package so the caller cannot ship copper on a guess', async () => {
    const withoutPackage: WebFetcher = async () => ({
      url: 'https://example.com/ds.txt',
      status: 200,
      contentType: 'application/pdf',
      bytes: 10,
      truncated: false,
      text: 'MPN: X\nSomebody\nDescription: a thing\nPins:\n| 1 | IN | Input |\n',
    })
    const tool = createWebTools(withoutPackage).find((entry) => entry.name === 'web.datasheet')!
    const result = await tool.handler({ url: 'https://example.com/ds.txt' }) as Record<string, unknown>
    expect(result.ok).toBe(true)
    expect((result.packaging as { packageStated: boolean }).packageStated).toBe(false)
    expect(String(result.note)).toContain('not stated')
  })

  it('does not register on deployments with no research origin', () => {
    const harness = new AgentHarness()
    expect(registerWebTools(harness, undefined)).toBe(0)
    expect(harness.listTools()).not.toContain('web.fetch')
  })

  it('registers exactly two tools when the fetcher exists', () => {
    const harness = new AgentHarness()
    expect(registerWebTools(harness, stubFetcher)).toBe(2)
    expect(harness.listTools().sort()).toEqual(['web.datasheet', 'web.fetch'])
  })

  it('makeDefaultWebFetcher builds only for an http(s) origin', () => {
    expect(makeDefaultWebFetcher(undefined)).toBeUndefined()
    expect(makeDefaultWebFetcher('not a url')).toBeUndefined()
    expect(makeDefaultWebFetcher('ftp://example.com')).toBeUndefined()
    expect(makeDefaultWebFetcher('http://127.0.0.1:54321/')).toBeDefined()
    expect(makeDefaultWebFetcher('https://folio.example.com/')).toBeDefined()
  })
})
