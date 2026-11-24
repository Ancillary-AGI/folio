import type { Metadata } from 'next'
import Console from '../components/Console'

export const metadata: Metadata = {
  title: 'Console',
  robots: { index: false, follow: false, noarchive: true },
}

export default function ConsolePage() {
  return <Console />
}
