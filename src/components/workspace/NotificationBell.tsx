/**
 * The workbench bell. Shows the real notification feed for this device:
 * agent job outcomes, exports, community previews — raised by code, persisted
 * under `folio.notifications.v1`, capped, dismissible, and readable/unread.
 * Nothing here is decorative: an empty feed says so, and the badge is the
 * honest unread count, not an engagement metric.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Bell, Check, CheckCheck, Download, History, Shapes, Trash2, X } from 'lucide-react'
import {
  clearAllNotifications,
  dismissNotification,
  formatNotificationTime,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeNotifications,
  unreadNotificationCount,
  type AppNotification,
  type NotificationKind,
} from '../../lib/notifications/notifications'
import CopilotIcon from './CopilotIcon'
import HoverHelp from '../ui/HoverHelp'

const EMPTY_SNAPSHOT: readonly AppNotification[] = []

function useNotificationFeed(): { items: AppNotification[]; unread: number } {
  const items = useSyncExternalStore(
    subscribeNotifications,
    () => getNotifications(),
    () => EMPTY_SNAPSHOT as AppNotification[],
  )
  const unread = useSyncExternalStore(
    subscribeNotifications,
    unreadNotificationCount,
    () => 0,
  )
  return { items, unread }
}

const KIND_ICONS: Record<NotificationKind, typeof CopilotIcon> = {
  agent: CopilotIcon,
  export: Download,
  community: Shapes,
  checkpoint: History,
}

const KIND_LABELS: Record<NotificationKind, string> = {
  agent: 'Copilot',
  export: 'Export',
  community: 'Community',
  checkpoint: 'Checkpoint',
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { items, unread } = useNotificationFeed()
  const panelRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        bellRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  const closeAndFocus = () => {
    setOpen(false)
    bellRef.current?.focus()
  }

  return (
    <div className="relative">
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Notifications — agent outcomes, exports and community previews from this device"
        data-tour="notification-bell"
        className="relative flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold tabular-nums leading-none text-primary-foreground"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeAndFocus} aria-hidden="true" />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-label="Notifications"
            tabIndex={-1}
            className="cad-glass-panel cad-popover-enter absolute right-0 z-50 mt-2 flex max-h-[28rem] w-[22rem] flex-col overflow-hidden rounded-xl border border-border shadow-2xl outline-none"
          >
            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Notifications
                {items.length > 0 && <span className="ml-1.5 tabular-nums text-foreground">{items.length}</span>}
              </p>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={() => markAllNotificationsRead()}
                    title="Mark every notification as read"
                    className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CheckCheck className="h-3 w-3" aria-hidden="true" />
                    Mark all read
                  </button>
                )}
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => clearAllNotifications()}
                    title="Remove every notification"
                    className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                <Check className="h-5 w-5 text-success" aria-hidden="true" />
                <p className="text-xs font-semibold text-foreground">All caught up</p>
                <p className="max-w-[16rem] text-[10px] leading-relaxed text-muted-foreground">
                  Agent results, export outcomes and community previews land here the moment they happen on this device.
                </p>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto" aria-label="Notification list">
                {items.map((item) => {
                  const Icon = KIND_ICONS[item.kind]
                  const unreadItem = !item.readAt
                  return (
                    <li key={item.id} className={`flex items-stretch transition-colors hover:bg-accent/30 ${unreadItem ? 'bg-primary/5' : ''}`}>
                      <button
                        type="button"
                        onClick={() => markNotificationRead(item.id)}
                        className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        aria-label={`${unreadItem ? 'Unread: ' : ''}${item.title}${item.detail ? `. ${item.detail}` : ''} — activate to mark read`}
                      >
                        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary/80" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            {unreadItem && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" aria-hidden="true" />}
                            <span className="truncate text-[11px] font-semibold leading-snug text-foreground">{item.title}</span>
                          </span>
                          {item.detail && <span className="mt-0.5 line-clamp-2 block text-[10px] leading-snug text-muted-foreground">{item.detail}</span>}
                          <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/80">
                            {KIND_LABELS[item.kind]} · {formatNotificationTime(item.at)}
                          </span>
                        </span>
                      </button>
                      <HoverHelp title="Dismiss notification" description="Dismiss this notification.">
                        <button
                          type="button"
                          onClick={() => dismissNotification(item.id)}
                          aria-label={`Dismiss: ${item.title}`}
                          className="m-1 flex h-7 w-7 flex-shrink-0 items-center justify-center self-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </HoverHelp>
                    </li>
                  )
                })}
              </ul>
            )}

            <p className="flex-shrink-0 border-t border-border/70 px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Stored on this device
            </p>
          </div>
        </>
      )}
    </div>
  )
}
