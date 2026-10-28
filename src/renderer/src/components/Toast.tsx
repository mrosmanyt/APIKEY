import { useApp } from '../lib/store'

export function Toast() {
  const toast = useApp((s) => s.toast)
  if (!toast) return null
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] -translate-x-1/2">
      <div
        className={`pointer-events-auto rounded-lg px-4 py-2 text-sm shadow-lg ${
          toast.kind === 'error'
            ? 'bg-red-600 text-white'
            : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
        }`}
        role="status"
      >
        {toast.text}
      </div>
    </div>
  )
}
