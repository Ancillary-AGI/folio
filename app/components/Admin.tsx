'use client'

import dynamic from 'next/dynamic'

const AdminApp = dynamic(() => import('../../src/admin/AdminApp'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        minHeight: '100vh',
        background: '#07080D',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#F2ECDF',
        fontFamily: 'var(--font-archivo), system-ui, sans-serif',
        fontSize: '.8rem',
        letterSpacing: '.18em',
        textTransform: 'uppercase',
      }}
    >
      Loading admin console…
    </div>
  ),
})

export default function Admin() {
  return <AdminApp />
}
