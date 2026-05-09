import './globals.css'
import 'sonner/dist/styles.css'
import AppShell from './AppShell'
import { Toaster } from 'sonner'
import type { ReactNode } from 'react'

// export { metadata } from './metadata'

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <AppShell>{children}</AppShell>
        <Toaster position="bottom-center" richColors closeButton />
      </body>
    </html>
  )
}
