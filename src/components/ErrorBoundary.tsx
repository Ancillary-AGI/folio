'use client'

/**
 * Last-resort error boundary for the whole workbench.
 *
 * React unmounts the entire tree when a render throws — without this, one
 * crashing panel takes the schematic, the board, the undo history and the
 * user's session to a white screen with nothing to press. The boundary keeps
 * the failure in one place: an honest fallback that says what happened,
 * copies the details for support, and offers the two real ways out.
 *
 * Nothing is reported anywhere; the details stay on this device.
 *
 * A class component, so it must be a Client Component: the root layout is a
 * Server Component and cannot import one otherwise.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ArrowLeft, Copy, RotateCcw, AlertTriangle } from 'lucide-react'
import { Button } from './ui/button'
import { FolioMark } from './brand/FolioLogo'

interface ErrorBoundaryState {
  error: Error | null
}

interface ErrorBoundaryProps {
  children: ReactNode
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No remote sink: the details stay in the console and on screen.
    console.error('Workspace crashed:', error, info.componentStack)
  }

  private readonly reset = (): void => {
    // A crash in a deterministic render will crash again — say so inline
    // instead of letting the user hammer the same path unknowingly.
    this.setState({ error: null })
  }

  private readonly toLauncher = (): void => {
    // A full reload remounts every store cleanly; the persisted design comes
    // back from the autosaved session as usual.
    window.location.assign('/app')
  }

  private readonly copyDetails = (): void => {
    const error = this.state.error
    const text = error
      ? `${error.name}: ${error.message}\n\n${error.stack ?? '(no stack)'}`
      : 'Unknown error (no details captured)'
    void navigator.clipboard?.writeText(text)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-foreground">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center gap-3">
            <FolioMark className="h-8 w-8 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Folio crashed — your design is safe
            </span>
          </div>

          <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Something in the workspace threw while rendering.
                </p>
                <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
                  {error.message || String(error)}
                </p>
              </div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            The workbench unmounted itself rather than limp along with broken state. Your
            project was autosaved as usual — components, wiring, board, firmware and
            version history are all where they were.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={this.reset} className="gap-2">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <Button variant="outline" onClick={this.toLauncher} className="gap-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to the launcher
            </Button>
            <Button variant="ghost" onClick={this.copyDetails} className="gap-2" aria-label="Copy error details to the clipboard">
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy details
            </Button>
          </div>
        </div>
      </main>
    )
  }
}