import type { Metadata } from 'next'
import Workbench from '../../components/Workbench'

export const metadata: Metadata = {
  title: 'Engineering workbench',
  applicationName: 'Folio',
  robots: { index: false, follow: false, noarchive: true },
}

export default function WorkbenchPage() {
  return <Workbench />
}
