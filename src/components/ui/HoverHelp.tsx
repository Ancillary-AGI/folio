import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { getHelpTopic, type HelpTopicId } from '../../lib/help/helpTopics'
import { computeTooltipPlacement, type TooltipSide } from '../../lib/help/tooltipLayout'

interface TriggerProps {
  onMouseEnter?: (event: ReactMouseEvent<HTMLElement>) => void
  onMouseLeave?: (event: ReactMouseEvent<HTMLElement>) => void
  onFocus?: (event: ReactFocusEvent<HTMLElement>) => void
  onBlur?: (event: ReactFocusEvent<HTMLElement>) => void
  'aria-describedby'?: string
}

export interface HoverHelpProps {
  /** Topic id from `helpTopics`; its title, description and keys are used. */
  topicId?: HelpTopicId
  title?: string
  description?: string
  keys?: readonly string[]
  /** Preferred side; flips to the opposite side when there is no room. */
  placement?: TooltipSide | 'auto'
  /**
   * Hover delay. Long enough that brushing across the rail does not flash a
   * card, short enough that resting on a control still teaches it. Focus
   * always opens immediately.
   */
  delayMs?: number
  children: ReactNode
}

const DEFAULT_DELAY_MS = 550

/**
 * CAD-style hover guide: rest on a control and a short card names it, says what
 * it does, and lists the keys that do the same thing. Keyboard focus opens the
 * card at once, Escape or scrolling dismisses it, and the trigger carries
 * `aria-describedby` only while the card is really on screen.
 */
export default function HoverHelp({
  topicId,
  title,
  description,
  keys,
  placement = 'auto',
  delayMs = DEFAULT_DELAY_MS,
  children,
}: HoverHelpProps) {
  const topic = topicId ? getHelpTopic(topicId) : undefined
  const heading = title ?? topic?.title
  const body = description ?? topic?.description
  const keycaps = keys ?? topic?.keys
  const enabled = Boolean(heading && body)

  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ left: number; top: number; side: TooltipSide } | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const focusedRef = useRef(false)
  const generatedId = useId()
  const tooltipId = `help-${generatedId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    return cancelTimer
  }, [cancelTimer])

  useEffect(() => {
    if (!open) return
    const dismiss = () => setOpen(false)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    const anchor = anchorRef.current
    if (!anchor) return
    const host = anchor.getBoundingClientRect()
    const tip = tooltipRef.current?.getBoundingClientRect()
    setCoords(
      computeTooltipPlacement(
        { left: host.left, top: host.top, width: host.width, height: host.height },
        { width: tip?.width ?? 0, height: tip?.height ?? 0 },
        { width: window.innerWidth, height: window.innerHeight },
        placement,
      ),
    )
  }, [open, placement, heading, body])

  const showNow = useCallback(() => {
    cancelTimer()
    setOpen(true)
  }, [cancelTimer])

  if (!enabled || !isValidElement(children)) return <>{children}</>

  const child = children as ReactElement<TriggerProps>
  const childProps = child.props

  const handleMouseEnter = (event: ReactMouseEvent<HTMLElement>) => {
    childProps.onMouseEnter?.(event)
    anchorRef.current = event.currentTarget
    cancelTimer()
    if (!open) timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setOpen(true)
    }, delayMs)
  }

  const handleMouseLeave = (event: ReactMouseEvent<HTMLElement>) => {
    childProps.onMouseLeave?.(event)
    cancelTimer()
    if (!focusedRef.current) setOpen(false)
  }

  const handleFocus = (event: ReactFocusEvent<HTMLElement>) => {
    childProps.onFocus?.(event)
    focusedRef.current = true
    anchorRef.current = event.currentTarget
    showNow()
  }

  const handleBlur = (event: ReactFocusEvent<HTMLElement>) => {
    childProps.onBlur?.(event)
    focusedRef.current = false
    cancelTimer()
    setOpen(false)
  }

  const describedBy = [childProps['aria-describedby'], open ? tooltipId : null].filter(Boolean).join(' ')
  const trigger = cloneElement(child, {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onFocus: handleFocus,
    onBlur: handleBlur,
    'aria-describedby': describedBy || undefined,
  })

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            data-side={coords?.side}
            className="pointer-events-none fixed w-max max-w-[280px] rounded-md border border-border bg-popover px-2.5 py-2 text-popover-foreground shadow-xl"
            style={{
              left: coords?.left ?? 0,
              top: coords?.top ?? 0,
              zIndex: 2000,
              visibility: coords ? 'visible' : 'hidden',
            }}
          >
            <p className="text-[11px] font-semibold leading-snug">{heading}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{body}</p>
            {keycaps && keycaps.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {keycaps.map((key, index) => (
                  <kbd key={`${key}-${index}`} className="cad-kbd">{key}</kbd>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
