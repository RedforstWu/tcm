import { useCallback, useSyncExternalStore } from 'react'

/** 与 Tailwind 默认 `sm` 断点保持一致 */
export const COMPACT_SCREEN_QUERY = '(max-width: 639px)'

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    [query],
  )
  const getSnapshot = () =>
    typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches)
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export function useIsCompactScreen(): boolean {
  return useMediaQuery(COMPACT_SCREEN_QUERY)
}
