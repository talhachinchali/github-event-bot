import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'
const KEY = 'theme'

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches
const stored = (): Theme => {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && systemDark()))
}

/** Call once before first render (main.tsx) so there is no flash of the wrong theme. */
export const initTheme = () => apply(stored())

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(stored)

  // In "system" mode, follow OS changes live.
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    if (t === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, t)
    setThemeState(t)
    apply(t)
  }, [])

  return { theme, setTheme }
}
