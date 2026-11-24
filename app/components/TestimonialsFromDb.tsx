'use client'

/**
 * Honest pull, honest silence. The quotes come from `testimonials`, where the
 * table is RLS-gated to what operators published — anyone can read, nobody
 * can write. No quotes → no section, no invented praise.
 */
import { useEffect, useState } from 'react'

interface TestiRow {
  quote: string
  author: string
  role: string
  company: string
}

export default function TestimonialsFromDb() {
  const [rows, setRows] = useState<TestiRow[] | null>(null)

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) { setRows([]); return }
    const endpoint = `${url.replace(/\/$/, '')}/rest/v1/testimonials?select=quote,author,role,company&published=eq.true&order=position.asc,id.asc`
    let cancelled = false
    fetch(endpoint, { headers: { apikey: anon, Accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) throw new Error('testimonials fetch failed')
        return res.json() as Promise<Array<{ quote?: unknown; author?: unknown; role?: unknown; company?: unknown }>>
      })
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return
        const parsed = data
          .map((row) => ({
            quote: typeof row.quote === 'string' ? row.quote : '',
            author: typeof row.author === 'string' ? row.author : '',
            role: typeof row.role === 'string' ? row.role : '',
            company: typeof row.company === 'string' ? row.company : '',
          }))
          .filter((row) => row.quote.length > 0 && row.author.length > 0)
        if (!cancelled) setRows(parsed)
      })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [])

  if (rows === null) return null /* still loading — keep silent until known */
  if (rows.length === 0) return null /* nothing to show, show nothing */

  return (
    <section className="site-section" aria-label="What people say">
      <div className="wrap">
        <div className="section-head"><h2>From the<br />labs that ship.</h2></div>
        <div className="strip-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {rows.map((row) => (
            <figure key={row.quote} style={{ margin: 0, border: '1px solid var(--line)', borderRadius: '.6rem', background: 'var(--card)', padding: '1.1rem 1.1rem .9rem' }}>
              <blockquote style={{ margin: 0, fontSize: '.82rem', lineHeight: 1.55, color: 'var(--ink)' }}>“{row.quote}”</blockquote>
              <figcaption style={{ marginTop: '.8rem', fontSize: '.68rem', color: 'var(--mute)' }}>
                <b>{row.author}</b>{row.role ? ` · ${row.role}` : ''}{row.company ? ` · ${row.company}` : ''}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
