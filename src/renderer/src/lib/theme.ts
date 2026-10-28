import { useEffect, useState } from 'react'
import { useApp } from './store'

const query = () => window.matchMedia('(prefers-color-scheme: dark)')

/** Resolved dark-mode flag (theme setting + OS preference); applies the `dark` class. */
export function useIsDark(apply = false): boolean {
  const theme = useApp((s) => s.settings?.theme ?? 'system')
  const [osDark, setOsDark] = useState(() => query().matches)
  useEffect(() => {
    const mq = query()
    const onChange = () => setOsDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const dark = theme === 'dark' || (theme === 'system' && osDark)
  useEffect(() => {
    if (apply) document.documentElement.classList.toggle('dark', dark)
  }, [apply, dark])
  return dark
}
