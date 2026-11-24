import { describe, expect, it } from 'vitest'
import { CrossDomainOrchestrator } from './crossDomainOrchestrator'

describe('CrossDomainOrchestrator', () => {
  it('flags net-count mismatches as errors and scores them', () => {
    const orchestrator = new CrossDomainOrchestrator()
    const snapshot = orchestrator.synchronize('project-1', {
      schematic: { nets: 12 },
      pcb: { nets: 10 },
    })
    expect(snapshot.issues).toContainEqual(expect.objectContaining({
      domain: 'pcb',
      severity: 'error',
    }))
    expect(snapshot.syncScore).toBe(75)
  })

  it('reports unrouted nets, an offline twin and SIEM alerts', () => {
    const orchestrator = new CrossDomainOrchestrator()
    const snapshot = orchestrator.synchronize('project-2', {
      pcb: { nets: 4, unrouted: 3 },
      twin: { status: 'offline' },
      siem: { alerts: 2 },
    })
    expect(snapshot.issues).toHaveLength(3)
    expect(snapshot.issues.every(issue => issue.severity === 'warning')).toBe(true)
    expect(snapshot.syncScore).toBe(76)
  })

  it('keeps a clean snapshot at 100 and returns the latest per project', () => {
    const orchestrator = new CrossDomainOrchestrator()
    orchestrator.synchronize('a', { schematic: { nets: 3 }, pcb: { nets: 3, unrouted: 0 } })
    const latest = orchestrator.synchronize('a', { pcb: { nets: 1, unrouted: 0 } })
    expect(latest.issues).toEqual([])
    expect(latest.syncScore).toBe(100)
    expect(orchestrator.latest('a')?.id).toBe(latest.id)
    expect(orchestrator.latest('missing')).toBeUndefined()
  })
})
