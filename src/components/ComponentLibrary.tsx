import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { DragEvent } from 'react'
import { Component } from '../lib/supabase';

interface ComponentLibraryProps {
  components: Component[];
  onSelectComponent: (component: Component) => void;
  selectedComponent?: Component | null;
}

/**
 * Parts browser docked beside the sheet: a bare search row over a grouped,
 * alphabetical list with sticky category headers. Rows are draggable onto
 * the sheet; clicking arms the part for click-to-place.
 */
export default function ComponentLibrary({ components, onSelectComponent, selectedComponent }: ComponentLibraryProps) {
  const [searchTerm, setSearchTerm] = useState('');

  /** Filter by search, then group by category (A–Z), sorted within each group. */
  const groups = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const shown = components.filter((comp) => {
      if (!query) return true;
      return (
        comp.name.toLowerCase().includes(query) ||
        !!comp.description?.toLowerCase().includes(query) ||
        comp.category.toLowerCase().includes(query) ||
        !!comp.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    });

    const byCategory = new Map<string, Component[]>();
    for (const comp of shown) {
      const bucket = byCategory.get(comp.category);
      if (bucket) bucket.push(comp);
      else byCategory.set(comp.category, [comp]);
    }

    return Array.from(byCategory.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({
        category,
        items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [components, searchTerm]);

  const shownCount = groups.reduce((total, group) => total + group.items.length, 0);

  /** Drives the canvas drop handler, which reads `componentId` from the drag payload. */
  const startDrag = (e: DragEvent<HTMLDivElement>, component: Component) => {
    if (!component.id) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('componentId', component.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      {/* Palette title */}
      <div className="cad-palette-title">
        <span>Library</span>
        <span className="font-mono tabular-nums normal-case tracking-normal">
          {shownCount}/{components.length}
        </span>
      </div>

      {/* Search row */}
      <div className="relative flex h-7 flex-shrink-0 items-center border-b border-border bg-background/40">
        <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search parts…"
          aria-label="Search parts"
          className="cad-search pl-7 pr-2"
        />
      </div>

      {/* Grouped parts list */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {shownCount === 0 ? (
          <p className="px-3 py-8 text-center text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            No matching parts
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.category}>
              <div className="cad-section-title">
                <span className="truncate">{group.category}</span>
                <span className="font-mono tabular-nums normal-case tracking-normal">{group.items.length}</span>
              </div>
              {group.items.map((component) => {
                const armed = component.id != null && selectedComponent?.id === component.id;
                return (
                  <div
                    key={component.id ?? component.name}
                    draggable
                    onDragStart={(e) => startDrag(e, component)}
                    onClick={() => onSelectComponent(component)}
                    title={
                      component.description
                        ? `${component.name} — ${component.description}`
                        : component.name
                    }
                    className={`cad-lib-row ${armed ? 'cad-lib-row-armed' : ''}`}
                  >
                    <span className="cad-glyph" aria-hidden="true">
                      {component.name.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px]">{component.name}</span>
                    <span className="cad-readout shrink-0 text-[10px] text-muted-foreground">
                      {component.pins.length}p
                    </span>
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>

      {/* Footer readout */}
      <div className="cad-palette-foot">
        <span>Click to arm · drag to place</span>
        <span className="tabular-nums normal-case tracking-normal">
          {shownCount}/{components.length}
        </span>
      </div>
    </div>
  );
}