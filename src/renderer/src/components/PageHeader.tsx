import type { ReactNode } from 'react'

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex min-h-[56px] flex-wrap items-center gap-3 border-b border-slate-200 bg-white/70 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
      <h1 className="mr-auto text-lg font-semibold">{title}</h1>
      {children}
    </header>
  )
}
