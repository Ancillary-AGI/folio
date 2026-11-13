import { beforeEach, describe, expect, it } from 'vitest'
import {
  NOTIFICATION_CAP,
  NOTIFICATIONS_STORAGE_KEY,
  clearAllNotifications,
  dismissNotification,
  formatNotificationTime,
  getNotifications,
  isNotificationStorePersistent,
  markAllNotificationsRead,
  markNotificationRead,
  notifyNotification,
  resetNotifications,
  unreadNotificationCount,
} from './notifications'

const HOUR = 3600_000
const DAY = 24 * HOUR

beforeEach(() => {
  localStorage.clear()
  resetNotifications()
})

describe('in-app notifications', () => {
  it('raises and returns notifications newest-first', () => {
    const now = Date.UTC(2026, 0, 10, 12)
    notifyNotification({ kind: 'export', title: 'Gerber export ready' }, now)
    notifyNotification({ kind: 'agent', title: 'Agent finished: router' }, now + 1000)
    const items = getNotifications()
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('Agent finished: router')
    expect(items[1].title).toBe('Gerber export ready')
  })

  it('collapses a duplicate raised inside 3 s but not after', () => {
    const now = 1000
    const first = notifyNotification({ kind: 'export', title: 'Gerber export ready', detail: 'x.gbr' }, now)
    const duplicate = notifyNotification({ kind: 'export', title: 'Gerber export ready', detail: 'x.gbr' }, now + 2500)
    expect(duplicate?.id).toBe(first?.id)
    expect(getNotifications()).toHaveLength(1)
    const later = notifyNotification({ kind: 'export', title: 'Gerber export ready', detail: 'x.gbr' }, now + 5000)
    expect(later?.id).not.toBe(first?.id)
    expect(getNotifications()).toHaveLength(2)
  })

  it('tracks unread honestly across reads, marks one, and marks all', () => {
    const now = 1000
    const first = notifyNotification({ kind: 'agent', title: 'one' }, now)!
    notifyNotification({ kind: 'community', title: 'two' }, now + 1000)
    expect(unreadNotificationCount()).toBe(2)
    markNotificationRead(first.id, now + 2000)
    expect(unreadNotificationCount()).toBe(1)
    // Dismissing a read entry is a no-op for the read filter.
    dismissNotification(first.id)
    expect(unreadNotificationCount()).toBe(1)
    markNotificationRead(first.id, now + 3000) // already gone: no crash, no change
    markAllNotificationsRead(now + 4000)
    expect(unreadNotificationCount()).toBe(0)
  })

  it('persists to storage and caps the feed', () => {
    const now = Date.UTC(2026, 0, 10, 12)
    notifyNotification({ kind: 'export', title: 'persisted' }, now)
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string)).toHaveLength(1)
    for (let index = 0; index < NOTIFICATION_CAP + 5; index += 1) {
      notifyNotification({ kind: 'agent', title: `job ${index}` }, now + 10_000 + index * 1000)
    }
    expect(getNotifications()).toHaveLength(NOTIFICATION_CAP)
    expect(getNotifications()[0].title).toBe(`job ${NOTIFICATION_CAP + 4}`)
  })

  it('clearAllNotifications empties the feed', () => {
    notifyNotification({ kind: 'export', title: 'one' }, 1000)
    notifyNotification({ kind: 'agent', title: 'two' }, 2000)
    clearAllNotifications()
    expect(getNotifications()).toHaveLength(0)
    expect(unreadNotificationCount()).toBe(0)
  })

  it('is persistent on healthy storage', () => {
    notifyNotification({ kind: 'export', title: 'one' }, 1000)
    expect(isNotificationStorePersistent()).toBe(true)
  })

  it('formats times without pretending precision', () => {
    const now = Date.UTC(2026, 0, 10, 12)
    expect(formatNotificationTime(now, now)).toBe('just now')
    expect(formatNotificationTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatNotificationTime(now - 3 * HOUR, now)).toBe('3h ago')
    expect(formatNotificationTime(now - DAY, now)).toBe('yesterday')
    expect(formatNotificationTime(now - 4 * DAY, now)).toBe('4d ago')
  })
})
