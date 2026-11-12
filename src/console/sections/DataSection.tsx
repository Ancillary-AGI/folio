/**
 * Data — what this browser profile actually holds, key by key, plus the one
 * escape hatch a local-first tool owes: a complete download of your data.
 */
import { useMemo } from 'react'
import { Database, Download, HardDrive } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { formatBytes, storageSnapshot, exportLocalData } from '../consoleData'
import { downloadFile } from '../../lib/exportUtils'

const SHOWN_KEYS = 12

export default function DataSection() {
  const snapshot = useMemo(() => storageSnapshot(), [])

  const download = () => {
    const { filename, json } = exportLocalData()
    downloadFile(json, filename, 'application/json')
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

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/40 p-4">
        <Database className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          This is this browser profile only — a different device or browser starts empty. Cloud designs, history
          and usage live in the deployment and are managed there, not here. Nothing is deleted from this page;
          downloads are copies.
        </p>
      </div>
    </div>
  )
}
