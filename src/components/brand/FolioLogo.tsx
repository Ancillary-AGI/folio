/**
 * Folio identity.
 *
 * The mark is a chamfered sheet with the F cut out of it — a folio is a bound
 * sheet, and the cut-out keeps the letter legible at 16 px without a second
 * colour. The wordmark is drawn as geometry rather than set in a font: the
 * letterforms are a squared industrial sans with 45° terminals, so the brand
 * renders identically on a machine with no fonts installed and in printed
 * drawings exported from the workbench.
 */

type LogoProps = {
  className?: string
  markClassName?: string
  wordmarkClassName?: string
  showTagline?: boolean
}

/** Standalone mark: 96 × 96, drawn in `currentColor`. */
export function FolioMark({ className = 'h-8 w-8 text-primary', title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 96 96"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M10 0H58L96 38V86L86 96H10L0 86V10ZM26 20H64L70 26V40H46V46H56L62 52V64H46V82H26Z"
      />
    </svg>
  )
}

/** Custom FOLIO letterforms: 408 × 100, five squared glyphs with cut terminals. */
export function FolioWordmark({ className = 'h-[15px] w-auto text-foreground' }: { className?: string }) {
  return (
    <svg viewBox="0 0 408 100" className={className} aria-hidden="true" focusable="false" fill="currentColor">
      {/* F */}
      <path d="M0 0H57L66 9V22H22V39H49L58 48V61H22V100H0Z" />
      {/* O */}
      <path fillRule="evenodd" d="M102 0H162L174 12V88L162 100H102L90 88V12ZM115 22H149L152 25V75L149 78H115L112 75V25Z" />
      {/* L */}
      <path d="M198 0H220V78H262V90L252 100H198Z" />
      {/* I */}
      <path d="M284 0H294L300 6V94L294 100H284L278 94V6Z" />
      {/* O */}
      <path fillRule="evenodd" d="M336 0H396L408 12V88L396 100H336L324 88V12ZM349 22H383L386 25V75L383 78H349L346 75V25Z" />
    </svg>
  )
}

export default function FolioLogo({
  className = '',
  markClassName = 'h-8 w-8 flex-shrink-0 text-primary',
  wordmarkClassName = 'h-[15px] w-auto text-foreground',
  showTagline = false,
}: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`} role="img" aria-label="Folio">
      <FolioMark className={markClassName} />
      {/* `items-start`, not the default stretch: in a column, stretch forces the
          wordmark to the tagline's width, and an SVG with a viewBox centres what
          it is given, so "FOLIO" sat dead middle over a left-aligned line of
          text. The lockup is flush left or it is not a lockup. */}
      <div className="flex min-w-0 flex-col items-start gap-0.5">
        <FolioWordmark className={wordmarkClassName} />
        {showTagline && (
          <span className="text-[11px] font-medium leading-none tracking-[0.01em] text-muted-foreground">
            Engineering workbench
          </span>
        )}
      </div>
    </div>
  )
}
