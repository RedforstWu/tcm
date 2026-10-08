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
  /**
   * modal：全屏遮罩（默认，药物页对比）
   * dock：仅右侧栏，左侧可继续点选图/列表
   */
  variant?: 'modal' | 'dock'
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
  variant = 'modal',
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
  const isDock = variant === 'dock'

  useEffect(() => {
    if (openIds.length === 0) return
    if (isDock) {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') onClose()
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }
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
  }, [openIds.length, onClose, isDock])

  if (openIds.length === 0) return null

  // 窄屏下单方占满宽度；多方时留出一截露出下一张卡片，提示可左右滑动
  const panelWidthClass =
    openFormulas.length === 1
      ? 'w-[min(100%,22rem)] max-sm:w-full'
      : openFormulas.length === 2
        ? 'w-[min(100%,20rem)] max-sm:w-[85%]'
        : 'w-[min(100%,18rem)] max-sm:w-[85%]'

  const shellWidthClass =
    openFormulas.length === 1
      ? 'w-[min(100vw,24rem)]'
      : openFormulas.length === 2
        ? 'w-[min(100vw,44rem)]'
        : 'w-[min(100vw,min(96vw,68rem))]'

  const shellMobileClass = isDock
    ? 'max-sm:h-[70vh] max-sm:w-full max-sm:rounded-t-2xl max-sm:border-t max-sm:border-stone-200'
    : 'max-sm:w-full'

  return createPortal(
    <div
      className={
        isDock
          ? 'pointer-events-none fixed inset-0 z-50 flex justify-end max-sm:items-end'
          : 'fixed inset-0 z-50 flex justify-end'
      }
    >
      {!isDock && (
        <button
          type="button"
          aria-label="关闭抽屉遮罩"
          className="absolute inset-0 bg-stone-900/35 backdrop-blur-[1px]"
          onClick={onClose}
        />
      )}
      <aside
        role="dialog"
        aria-modal={!isDock}
        aria-label="方剂对比抽屉"
        className={`pointer-events-auto relative flex h-full flex-col bg-[#fffdf8] shadow-2xl ${shellWidthClass} ${shellMobileClass}`}
      >
        <header
          className={`flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 ${
            isDock ? '' : 'max-sm:pt-[max(0.75rem,env(safe-area-inset-top))]'
          }`}
        >
          <div className="min-w-0">
            <h2 className="font-serif text-lg font-bold">
              {openFormulas.length > 1 ? '方剂对比' : '方剂详情'}
            </h2>
            <p className="text-xs text-stone-500">
              {isDock
                ? `已打开 ${openFormulas.length} 方 · 可继续点击图中节点加入`
                : `已打开 ${openFormulas.length} 方 · 可继续点选其他方剂加入对比`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="hidden rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50 sm:inline-block"
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
          <div className="border-b border-stone-200 px-4 py-2 text-xs text-stone-500 max-sm:max-h-20 max-sm:overflow-y-auto">
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

        <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden p-4 scrollbar-thin max-sm:p-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:snap-none">
          {openFormulas.map((formula) => (
            <section
              key={formula.id}
              className={`flex h-full shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white ${panelWidthClass}`}
            >
              <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
                <span className="truncate font-serif text-sm font-semibold">
                  {convertScript(formula.name, scriptMode)}
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${formula.name}`}
                  onClick={() => onRemove(formula.id)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-cinnabar max-sm:h-9 max-sm:w-9"
                >
                  <FontAwesomeIcon icon={faTimes} className="text-xs" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain p-4 scrollbar-thin max-sm:p-3">
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
