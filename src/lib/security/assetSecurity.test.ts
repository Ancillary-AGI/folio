import { describe, expect, it } from 'vitest'
import { AssetSecurityService } from './assetSecurity'

describe('AssetSecurityService', () => {
  it('enforces role-based access for each action', () => {
    const service = new AssetSecurityService()
    service.grant('owner-1', 'board-1', 'owner')
    service.grant('viewer-1', 'board-1', 'viewer')

    expect(service.can('owner-1', 'board-1', 'delete')).toBe(true)
    expect(service.can('viewer-1', 'board-1', 'read')).toBe(true)
    expect(service.can('viewer-1', 'board-1', 'write')).toBe(false)
    expect(service.can('stranger', 'board-1', 'read')).toBe(false)

    service.revoke('viewer-1', 'board-1')
    expect(service.can('viewer-1', 'board-1', 'read')).toBe(false)
  })

  it('round-trips an AES-GCM asset and records every operation', async () => {
    const service = new AssetSecurityService()
    service.grant('alice', 'board-1', 'owner')

    const record = await service.encryptAsset('alice', 'board-1', 'secret netlist', 'correct horse')
    expect(record.algorithm).toBe('AES-GCM-256')
    expect(record.ciphertext).not.toContain('secret netlist')
    expect(service.isEncrypted('board-1')).toBe(true)

    await expect(service.decryptAsset('alice', 'board-1', 'correct horse')).resolves.toBe('secret netlist')
    const trail = service.getAuditTrail('board-1')
    expect(trail.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['grant:owner', 'encrypt', 'decrypt']),
    )
    expect(trail.every((entry) => entry.ok)).toBe(true)
  })

  it('refuses unauthorised operations and records the refusal', async () => {
    const service = new AssetSecurityService()
    service.grant('viewer', 'board-1', 'viewer')

    await expect(service.encryptAsset('viewer', 'board-1', 'data', 'pass')).rejects.toThrow(/Not authorised/)
    await expect(service.decryptAsset('stranger', 'board-1', 'pass')).rejects.toThrow(/Not authorised/)

    const denied = service.getAuditTrail('board-1').filter((entry) => !entry.ok)
    expect(denied).toHaveLength(2)
    expect(denied.map((entry) => entry.action)).toEqual(expect.arrayContaining(['encrypt', 'decrypt']))
  })

  it('rejects the wrong passphrase without returning plaintext', async () => {
    const service = new AssetSecurityService()
    service.grant('alice', 'board-1', 'owner')
    await service.encryptAsset('alice', 'board-1', 'secret', 'right-passphrase')

    await expect(service.decryptAsset('alice', 'board-1', 'wrong-passphrase')).rejects.toThrow(/Decryption failed/)
    const failed = service.getAuditTrail('board-1').find((entry) => entry.action === 'decrypt')
    expect(failed?.ok).toBe(false)
    expect(service.getAuditTrail('board-1').every((entry) => entry.detail !== 'secret')).toBe(true)
  })
})
