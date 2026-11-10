import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { DragEvent } from 'react'
import { writeLibraryDrag } from '../../lib/library/drag'
import type { LibraryItem } from '../../lib/library/types'

interface DomainLibraryDockProps {
  items: LibraryItem[]
  /** What this dock is called in the workspace, e.g. `Mechanical parts`. */
  label: string
  /** Search placeholder — names what the catalog actually holds. */
  placeholder?: string
  /** Short line under the list; every workspace states its own gesture. */
  hint?: string
  armed?: LibraryItem | null
  onArm: (item: LibraryItem | null) => void
  onClose?: () => void
}

/** A row can only be dragged if a panel can resolve it back to something real. */
function isDraggable(item: LibraryItem): boolean {
  return item.kind !== 'component' || item.payload.componentId !== ''
}

/**
 * The library dock shared by every workspace that places things.
 *
 * One search row over a category-grouped list, the same shape the schematic dock
 * had, but the rows are domain-neutral: mechanical solids, robot elements,
 * transfer-function blocks, RF chain elements, machines, buses and code all
 * render here and drag with the same payload the drop zones read.
 */
export default function DomainLibraryDock({
  items,
  label,
  placeholder = 'Search parts…',
  hint = 'Drag onto the design · click to arm',
  armed,
  onArm,
  onClose,
}: DomainLibraryDockProps) {
  const [searchTerm, setSearchTerm] = useState('')

  /** Filter by search, then group by category (A–Z), sorted within each group. */
  const groups = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const shown = items.filter((item) => {
      if (!query) return true
      return (
        item.name.toLowerCase().includes(query) ||
        !!item.spec?.toLowerCase().includes(query) ||
        !!item.description?.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query) ||
        !!item.tags?.some((tag) => tag.toLowerCase().includes(query))
      )
    })

    const byCategory = new Map<string, LibraryItem[]>()
    for (const item of shown) {
      const bucket = byCategory.get(item.category)
      if (bucket) bucket.push(item)
      else byCategory.set(item.category, [item])
    }

    return Array.from(byCategory.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, rows]) => ({
        category,
        items: [...rows].sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [items, searchTerm])

  const shownCount = groups.reduce((total, group) => total + group.items.length, 0)

  const startDrag = (event: DragEvent<HTMLButtonElement>, item: LibraryItem) => {
    if (!isDraggable(item)) {
      event.preventDefault()
      return
    }
    writeLibraryDrag(event.dataTransfer, item)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      <div className="cad-palette-title">
        <span className="truncate">{label}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close the ${label.toLowerCase()} dock`}
            title={`Close the ${label.toLowerCase()} dock`}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="relative flex h-7 flex-shrink-0 items-center border-b border-border bg-background/40">
        <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={placeholder}
          aria-label={`Search ${label.toLowerCase()}`}
          data-library-search
          className="cad-search pl-7 pr-2"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {shownCount === 0 ? (
          <p className="px-3 py-8 text-center text-[11px] text-muted-foreground">
            No matching rows
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.category}>
              <div className="cad-section-title">
                <span className="truncate">{group.category}</span>
                <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{group.items.length}</span>
              </div>
              {group.items.map((item) => {
                const armedRow = item.id === armed?.id
                const draggable = isDraggable(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    draggable={draggable}
                    onDragStart={(event) => startDrag(event, item)}
                    onClick={() => onArm(armedRow ? null : item)}
                    aria-pressed={armedRow}
                    title={
                      draggable
                        ? [item.name, item.spec, item.description, item.detail].filter(Boolean).join(' — ')
                        : `${item.name} has no id in this project's parts list, so it cannot be placed yet.`
                    }
                    className={`cad-lib-row ${armedRow ? 'cad-lib-row-armed' : ''} ${draggable ? '' : 'opacity-50'}`}
                  >
                    <span className="cad-glyph" aria-hidden="true">
                      {item.name.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left text-xs">{item.name}</span>
                    {item.spec && (
                      <span className="cad-readout ml-auto min-w-0 max-w-[46%] truncate text-[11px] text-muted-foreground">{item.spec}</span>
                    )}
                  </button>
                )
              })}
            </section>
          ))
        )}
      </div>

      <div className="cad-palette-foot">
        <span className="truncate">{hint}</span>
        <span className="tabular-nums normal-case tracking-normal">
          {shownCount}/{items.length}
        </span>
      </div>
    </div>
  )
}
