import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { faTimes, faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { Clause, Formula } from '@/types/data'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'
import { FormulaCard } from '@/components/FormulaCard'

interface FormulaCompareDrawerProps {
  openIds: string[]
  formulas: Formula[]
  clauses: Clause[]
  highlightHerbId?: string
  onClose: () => void
  onRemove: (formulaId: string) => void
}

function collectUnionHerbNames(formulas: Formula[]): string[] {
  const names = new Set<string>()
  for (const formula of formulas) {
    for (const herb of formula.herbs) names.add(herb.name)
  }
  return [...names]
}

export function FormulaCompareDrawer({
  openIds,
  formulas,
  clauses,
  highlightHerbId,
  onClose,
  onRemove,
}: FormulaCompareDrawerProps) {
  const { scriptMode } = useAppContext()
  const openFormulas = useMemo(
    () =>
      openIds
        .map((id) => formulas.find((formula) => formula.id === id))
        .filter((formula): formula is Formula => Boolean(formula)),
    [openIds, formulas],
  )

  const unionHerbs = useMemo(() => collectUnionHerbNames(openFormulas), [openFormulas])

  useEffect(() => {
    if (openIds.length === 0) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [openIds.length, onClose])

  if (openIds.length === 0) return null

  const panelWidthClass =
    openFormulas.length === 1
      ? 'w-full max-w-xl'
      : openFormulas.length === 2
        ? 'w-[min(100%,42rem)]'
        : 'w-[min(100%,28rem)]'

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="关闭抽屉遮罩"
        className="absolute inset-0 bg-stone-900/35 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="方剂对比抽屉"
        className="relative flex h-full w-full max-w-[100vw] flex-col bg-[#fffdf8] shadow-2xl md:max-w-[min(96vw,72rem)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <div>
            <h2 className="font-serif text-lg font-bold">方剂对比</h2>
            <p className="text-xs text-stone-500">
              已打开 {openFormulas.length} 方 · 可继续点选其他方剂加入对比
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
            >
              全部关闭
            </button>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </header>

        {openFormulas.length >= 2 && unionHerbs.length > 0 && (
          <div className="border-b border-stone-200 px-4 py-2 text-xs text-stone-500">
            共现药味：
            {unionHerbs
              .filter((name) =>
                openFormulas.every((formula) => formula.herbs.some((herb) => herb.name === name)),
              )
              .join('、') || '无'}
            <span className="mx-2 text-stone-300">|</span>
            仅部分方有：
            {unionHerbs
              .filter(
                (name) =>
                  !openFormulas.every((formula) => formula.herbs.some((herb) => herb.name === name)),
              )
              .join('、') || '无'}
          </div>
        )}

        <div className="flex flex-1 gap-3 overflow-x-auto overflow-y-hidden p-4 scrollbar-thin">
          {openFormulas.map((formula) => (
            <section
              key={formula.id}
              className={`flex h-full shrink-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white ${panelWidthClass}`}
            >
              <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
                <span className="truncate font-serif text-sm font-semibold">
                  {convertScript(formula.name, scriptMode)}
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${formula.name}`}
                  onClick={() => onRemove(formula.id)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-cinnabar"
                >
                  <FontAwesomeIcon icon={faTimes} className="text-xs" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
                <FormulaCard
                  formula={formula}
                  clauses={clauses}
                  highlightHerbId={highlightHerbId}
                  compact
                />
              </div>
            </section>
          ))}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
