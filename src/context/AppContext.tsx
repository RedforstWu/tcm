import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ScriptMode } from '@/lib/text'

interface AppContextValue {
  scriptMode: ScriptMode
  setScriptMode: (mode: ScriptMode) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [scriptMode, setScriptMode] = useState<ScriptMode>('simplified')
  const value = useMemo(() => ({ scriptMode, setScriptMode }), [scriptMode])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppProvider')
  return ctx
}
