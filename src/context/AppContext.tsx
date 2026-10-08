import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Corpus } from '@/types/data'
import type { ScriptMode } from '@/lib/text'

export type CorpusFilter = Corpus | 'all'

interface AppContextValue {
  scriptMode: ScriptMode
  setScriptMode: (mode: ScriptMode) => void
  corpusFilter: CorpusFilter
  setCorpusFilter: (corpus: CorpusFilter) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [scriptMode, setScriptMode] = useState<ScriptMode>('simplified')
  const [corpusFilter, setCorpusFilter] = useState<CorpusFilter>('all')
  const value = useMemo(
    () => ({ scriptMode, setScriptMode, corpusFilter, setCorpusFilter }),
    [scriptMode, corpusFilter],
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppProvider')
  return ctx
}
