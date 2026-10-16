export type Theme = 'light' | 'dark' | 'system'

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return getSystemTheme()
  return theme
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  const resolved = resolveTheme(theme)
  const root = document.documentElement
  root.setAttribute('data-theme', resolved)
  root.style.colorScheme = resolved
}
