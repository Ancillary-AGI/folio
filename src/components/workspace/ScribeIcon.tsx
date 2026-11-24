import { forwardRef, type SVGProps } from 'react'

/**
 * Scribe's mark: a pen nib drawn in the same stroke-first grammar as the
 * lucide set. The agent is Folio's notebook with opinions — it writes what
 * the sheet supports and refuses the rest, so it reads like a nib, not a bot.
 */
const ScribeIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(function ScribeIcon(props, ref) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M 12,2.5 L 18.5,9 L 12,21.5 L 5.5,9 Z" />
      <path d="M 12,12 L 12,21.5" />
      <circle cx="12" cy="9.25" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  )
})

export default ScribeIcon
