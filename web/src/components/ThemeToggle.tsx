import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme'

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <Button variant="ghost" size="icon" aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(isDark ? 'light' : 'dark')}>
      {isDark ? <Sun /> : <Moon />}
    </Button>
  )
}
