/**
 * A real 404 surface for paths that are not part of the app.
 *
 * The router already canonicalises genuinely unknown paths; this view is what
 * the user sees on the way there — named plainly, with honest exits, instead
 * of a silent redirect to the launcher that looks like the "New Project"
 * button did nothing.
 */
import { useEffect } from 'react'
import { ArrowRight, Home, LayoutGrid, Presentation, Users } from 'lucide-react'
import FolioLogo from './brand/FolioLogo'
import { APP_BASE, PROJECTS_ROUTE, COMMUNITY_ROUTE } from '../stores/routing'

interface NotFoundProps {
  /** Path shown in the error — the raw URL, not guessed. */
  path: string
}

export default function NotFound({ path }: NotFoundProps) {
  useEffect(() => {
    document.title = `404 — ${path} — Folio`
  }, [path])

  /*
   * The demo CTA is the one we pin: the proven board is the exit engineers
   * who landed here by accident are most likely to want, and it works on a
   * fresh device with nothing configured.
   */
  const exits: Array<{ label: string; detail: string; href: string; icon: typeof Home }> = [
    { label: 'Launcher', detail: 'your projects and every demo on this machine', href: PROJECTS_ROUTE, icon: LayoutGrid },
    { label: 'Rectifier demo', detail: 'the proven 6 Vpk board from schematic to fab package', href: `${APP_BASE}/demos/rectifier-pcb`, icon: Presentation },
    { label: 'Community', detail: 'designs CC-BY, yours to open and make yours', href: COMMUNITY_ROUTE, icon: Users },
    { label: 'Home', detail: 'one brief in, one verified board out', href: '/', icon: Home },
  ]

  return (
    <main className="launcher-shell flex min-h-screen flex-col bg-background" aria-label="Page not found">
      <header className="app-chrome app-chrome-divider flex-shrink-0">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <FolioLogo
            markClassName="h-8 w-8 flex-shrink-0 text-primary"
            wordmarkClassName="h-[15px] w-auto text-surface-foreground"
            showTagline
          />
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl text-center">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-primary/80">
            Route error · 404
          </p>
          <h1 className="mt-3 text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
            This path isn’t<br />
            <span className="text-primary">a real page.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            <span className="font-mono text-foreground/85">{path}</span> doesn’t map onto any workspace,
            demo or document served here. Every exit below works; nothing about this failure is silent.
          </p>

          <nav aria-label="Where you can go from here" className="mx-auto mt-8 grid gap-2 text-left">
            {exits.map(({ label, detail, href, icon: Icon }) => (
              <a
                key={href}
                href={href}
                className="group flex items-center gap-4 rounded-xl border border-border/60 bg-card/50 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-card"
              >
                <Icon className="h-5 w-5 flex-shrink-0 text-primary/90" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                </span>
                <ArrowRight
                  className="h-4 w-4 flex-shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                  aria-hidden="true"
                />
              </a>
            ))}
          </nav>
        </div>
      </div>

      <footer className="border-t border-border/60 py-3 text-center text-[11px] text-muted-foreground/70">
        © 2026 Folio. All rights reserved.
      </footer>
    </main>
  )
}
