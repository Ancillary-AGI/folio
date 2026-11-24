import type { Metadata } from 'next'
import Admin from '../components/Admin'

export const metadata: Metadata = {
  title: 'Admin console',
  robots: { index: false, follow: false, noarchive: true },
}

export default function AdminPage() {
  return <Admin />
}
