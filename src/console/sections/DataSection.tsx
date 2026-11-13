/**
 * Data — what this browser profile actually holds, key by key, plus the two
 * escape hatches a local-first tool owes: a complete download of your data,
 * and a real wipe of it.
 */
import { useMemo, useState } from 'react'
import { Database, Download, HardDrive, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { formatBytes, storageSnapshot, exportLocalData } from '../consoleData'
import { downloadFile } from '../../lib/exportUtils'

const SHOWN_KEYS = 12

/** Keys this app owns. Anything not listed here belongs to something else and is left alone. */
const FOLIO_KEY_PREFIXES = ['folio.', 'folio-', 'circuit-cad-']

export default function DataSection() {
  const snapshot = useMemo(() => storageSnapshot(), [])
  const folioKeys = useMemo(
    () => snapshot.entries.map((entry) => entry.key).filter((key) => FOLIO_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))),
    [snapshot],
  )
  const [eraseOpen, setEraseOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const readyToErase = typed.trim().toLowerCase() === 'erase'

  const download = () => {
    const { filename, json } = exportLocalData()
    downloadFile(json, filename, 'application/json')
  }

  const eraseAll = () => {
    for (const key of folioKeys) localStorage.removeItem(key)
    // Reload: the app must start from a clean slate, not a half-erased cache.
    window.location.assign('/console')
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 p-4">
        <div className="flex items-center gap-3">
          <HardDrive className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-foreground">{formatBytes(snapshot.totalBytes)} total</p>
            <p className="text-[11px] text-muted-foreground">{snapshot.entries.length} storage keys in this browser profile</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={download} className="gap-2">
          <Download className="h-4 w-4" aria-hidden="true" />
          Download local data (JSON)
        </Button>
      </div>

      <section aria-labelledby="storage-heading">
        <h2 id="storage-heading" className="text-sm font-bold text-foreground">Where it lives</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Bytes are approximate (UTF-16 code units). Keys this app writes are named; the rest are listed as they are.
        </p>
        <div className="mt-2 overflow-hidden rounded-xl border border-border/70">
          <table className="w-full text-left text-xs">
            <thead className="bg-card/80 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">What</th>
                <th scope="col" className="px-4 py-2 font-semibold text-right">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 bg-card/40">
              {snapshot.entries.slice(0, SHOWN_KEYS).map((entry) => (
                <tr key={entry.key}>
                  <td className="px-4 py-2">
                    <span className="block font-medium text-foreground">{entry.label}</span>
                    <span className="block font-mono text-[10px] text-muted-foreground/80">{entry.key}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatBytes(entry.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {snapshot.entries.length > SHOWN_KEYS && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">+ {snapshot.entries.length - SHOWN_KEYS} more keys, included in the download.</p>
        )}
      </section>

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Trash2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-foreground">Erase this device's Folio data</h2>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                Deletes every key this app owns from this browser profile: your designs, checkpoints, VCS branches,
                backups, the usage ledger and local profiles. Other keys on this device are left alone.
                There is no recovery — download your data first if you want it.
              </p>
            </div>
          </div>
          {!eraseOpen && (
            <Button variant="outline" size="sm" onClick={() => setEraseOpen(true)} className="border-destructive/40 text-destructive hover:bg-destructive/10">
              Erase…
            </Button>
          )}
        </div>
        {eraseOpen && (
          <div className="mt-3 border-t border-destructive/20 pt-3">
            <label htmlFor="erase-confirm" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-destructive">
              Type erase to confirm — {folioKeys.length} keys will be removed
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Input
                id="erase-confirm"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="erase"
                autoFocus
                autoComplete="off"
                aria-label="Type erase to confirm"
                className="max-w-[12rem]"
              />
              <Button variant="outline" size="sm" disabled={!readyToErase} onClick={eraseAll} className="border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20">
                Erase everything
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setEraseOpen(false); setTyped('') }}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/40 p-4">
        <Database className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          This is this browser profile only — a different device or browser starts empty. Cloud designs, history
          and usage live in the deployment and are managed there, not here. Wipe is keyboard accessible; downloads
          are copies, not moves.
        </p>
      </div>
    </div>
  )
}
