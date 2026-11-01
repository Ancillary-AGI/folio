import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Undo2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useShortcutStore } from '../../stores/useShortcutStore'
import { EDITOR_KEYS } from '../../lib/keymap/shortcuts'
import {
  SHORTCUTS,
  allConflicts,
  bindingFromEvent,
  findConflict,
  formatBinding,
  resolveBinding,
  type KeyBinding,
  type Platform,
} from '../../lib/keymap/shortcuts'

interface ShortcutEditorProps {
  /** Live search terms from the guide; rows that do not match stay hidden. */
  query: string
  platform?: Platform
}

function matchesTerms(terms: string[], haystack: string): boolean {
  if (terms.length === 0) return true
  const value = haystack.toLowerCase()
  return terms.every((term) => value.includes(term))
}

/**
 * Editable copy of the shortcut sheet.
 *
 * Clicking a binding captures the next chord. A chord already owned by another
 * action in the same scope is refused with the owner named, because accepting
 * it would silently stop one of the two actions from ever firing.
 */
export default function ShortcutEditor({ query, platform }: ShortcutEditorProps) {
  const overrides = useShortcutStore((state) => state.overrides)
  const setBinding = useShortcutStore((state) => state.setBinding)
  const resetBinding = useShortcutStore((state) => state.resetBinding)
  const resetAll = useShortcutStore((state) => state.resetAll)
  const [capturing, setCapturing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query])
  const conflicts = useMemo(() => allConflicts(overrides), [overrides])
  const editorRows = useMemo(
    () => EDITOR_KEYS.filter((row) => matchesTerms(terms, `${row.action} ${row.where} ${row.keys.join(' ')}`)),
    [terms],
  )

  const rows = useMemo(
    () =>
      SHORTCUTS.filter((definition) => {
        const keys = (resolveBinding(definition.id, overrides) ? formatBinding(resolveBinding(definition.id, overrides)!, platform) : []).join(' ')
        return matchesTerms(terms, `${definition.action} ${definition.where} ${keys}`)
      }),
    [terms, overrides, platform],
  )

  useEffect(() => {
    if (!capturing) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setCapturing(null)
        setError(null)
        return
      }
      const binding: KeyBinding | null = bindingFromEvent(event, platform)
      // A bare modifier is not a chord; wait for the real key.
      if (!binding) return
      const owner = findConflict(capturing, binding, overrides)
      if (owner) {
        setError(`“${formatBinding(binding, platform).join('+')}” already runs “${owner.action}” in ${owner.where}. Pick another chord.`)
        return
      }
      setBinding(capturing, binding)
      setCapturing(null)
      setError(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capturing, overrides, platform, setBinding])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Click a binding, then press the chord you want. Bindings are saved on this device.
          Two actions in the same scope cannot share a chord.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px]"
          onClick={() => { resetAll(); setCapturing(null); setError(null) }}
          disabled={Object.keys(overrides).length === 0}
        >
          <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" />
          Reset all
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          {error}
        </p>
      )}

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-border text-left text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            <th scope="col" className="py-1.5 pr-3 font-semibold">Keys</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Action</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Where</th>
            <th scope="col" className="py-1.5 font-semibold"><span className="sr-only">Binding actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((definition) => {
            const binding = resolveBinding(definition.id, overrides) ?? definition.binding
            const customised = Boolean(overrides[definition.id])
            const conflict = conflicts.get(definition.id)
            const isCapturing = capturing === definition.id
            const labels = formatBinding(binding, platform)
            return (
              <tr key={definition.id} className="border-b border-border last:border-0">
                <td className="py-1.5 pr-3 align-top">
                  {isCapturing ? (
                    <span className="inline-flex items-center gap-1 rounded border border-primary/50 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      Press keys… <span className="text-muted-foreground">Esc cancels</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Change binding for ${definition.action}`}
                      onClick={() => { setCapturing(definition.id); setError(null) }}
                      className="flex flex-wrap items-center gap-1 rounded border border-transparent px-1 py-0.5 hover:border-border hover:bg-muted/60"
                    >
                      {labels.map((key, index) => (
                        <kbd key={`${key}-${index}`} className="cad-kbd">{key}</kbd>
                      ))}
                    </button>
                  )}
                  {(definition.alternates ?? []).map((alternate) => (
                    <span key={formatBinding(alternate, platform).join('+')} className="ml-1 inline-flex items-center">
                      <kbd className="cad-kbd">{formatBinding(alternate, platform).join(platform === 'mac' ? '' : '+')}</kbd>
                    </span>
                  ))}
                </td>
                <td className="py-1.5 pr-3 align-top text-foreground">
                  {definition.action}
                  {conflict && (
                    <span className="mt-0.5 block text-[10px] text-destructive">
                      Also bound to “{conflict.action}”
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3 align-top text-muted-foreground">{definition.where}</td>
                <td className="py-1.5 align-top text-right">
                  {customised && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[10px]"
                      aria-label={`Reset the binding for ${definition.action}`}
                      onClick={() => resetBinding(definition.id)}
                    >
                      <Undo2 className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Inside a code surface
        </h3>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The editor owns these while a code field has focus, so they are listed
          but not rebindable.
        </p>
        <ul className="divide-y divide-border rounded-md border border-border">
          {editorRows.map((row) => (
            <li key={row.action} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[11px]">
              <span className="flex items-center gap-1">
                {row.keys.map((key) => (
                  <kbd key={key} className="cad-kbd">{key}</kbd>
                ))}
              </span>
              <span className="text-foreground">{row.action}</span>
              <span className="ml-auto text-muted-foreground">{row.where}</span>
            </li>
          ))}
        </ul>
      </section>

      {rows.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No shortcut matches “{query}”.</p>
      )}
    </div>
  )
}
