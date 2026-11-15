import { forwardRef, type SVGProps } from 'react'

/**
 * The robotics seat in the rail: a two-joint arm drawn in the same 24 px,
 * stroke-first grammar as the lucide set, so the rail keeps one voice. The
 * agent is Sparkles; this is a machine, not a personality.
 */
const RobotArmIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(function RobotArmIcon(props, ref) {
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
      <path d="M 2.5,21.5 H 21.5" />
      <path d="M 6,21.5 V 15.5" />
      <path d="M 6,15.5 L 12,10" />
      <path d="M 12,10 L 17,13.5" />
      <path d="M 17,13.5 L 15.3,17.4 M 17,13.5 L 19.6,16.5" />
      <circle cx="6" cy="15.5" r="1.6" />
      <circle cx="12" cy="10" r="1.6" />
    </svg>
  )
})

export default RobotArmIcon
