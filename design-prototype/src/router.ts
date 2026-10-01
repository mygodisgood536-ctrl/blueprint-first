import { useState, useEffect, useCallback } from 'react'

export function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return hash
}

export function navigate(hash: string) {
  window.location.hash = hash
}

/**
 * A declarative redirect.
 *
 * Used for retired routes so a stale bookmark or an old deep link lands on the
 * intended destination instead of rendering a page. Retired routes must never
 * become a second, differently-named entry point: they only ever forward.
 */
export function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to)
  }, [to])
  return null
}

export function parseRoute(hash: string) {
  const clean = hash.replace(/^#/, '')
  const [path, queryStr] = clean.split('?')
  const query: Record<string, string> = {}
  if (queryStr) queryStr.split('&').forEach(p => { const [k, v] = p.split('='); if (k) query[k] = decodeURIComponent(v || '') })
  const parts = path.split('/').filter(Boolean)
  return { path, parts, query }
}

export function useQueryParams() {
  const hash = useHashRoute()
  return useCallback(() => parseRoute(hash).query, [hash])
}


