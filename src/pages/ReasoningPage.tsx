import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  faCodeBranch,
  faFlask,
  faRotateLeft,
  faScaleUnbalanced,
  faTriangleExclamation,
  faYinYang,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { DraftBanner } from '@/components/DraftBanner'
import { ChenfuCaseBrowser } from '@/components/reasoning/ChenfuCaseBrowser'
import { CompareView } from '@/components/reasoning/CompareView'
import {
  DecisionStepper,
  type DecisionStep,
} from '@/components/reasoning/DecisionStepper'
import { NatureChart } from '@/components/reasoning/NatureChart'
import { ReasoningChain } from '@/components/reasoning/ReasoningChain'
import { TreeOverview } from '@/components/reasoning/TreeOverview'
import { VariantPanel } from '@/components/reasoning/VariantPanel'
import { loadChenfuReasoning, loadDiffPairs, loadFormulas, loadReasoning } from '@/lib/data'
import { reasoningCardVisibility } from '@/lib/reasoning-display'
import { reasoningSafetyNotice } from '@/lib/reasoning-safety'
import { CHENFU_BOOK_LABELS } from '@/lib/chenfu'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'
import type {
  ChenfuReasoningBook,
  ChenfuReasoningDataset,
  Formula,
  FormulaDiffPair,
  FormulaReasoning,
  ReasoningDataset,
  TreeResult,
} from '@/types/data'

type ReasoningMode = 'jingfang' | 'chenfu' | 'compare'

const MODES: Array<{ id: ReasoningMode; label: string; icon: IconDefinition }> = [
  { id: 'jingfang', label: '经方·方证', icon: faCodeBranch },
  { id: 'chenfu', label: '陈傅·病机', icon: faYinYang },
  { id: 'compare', label: '两派对照', icon: faScaleUnbalanced },
]

function isReasoningMode(value: string | null): value is ReasoningMode {
  return value === 'jingfang' || value === 'chenfu' || value === 'compare'
}

function splitNames(formulaName: string): string[] {
  return formulaName
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
}

function findReasoning(
  formulas: FormulaReasoning[],
  name: string,
): FormulaReasoning | undefined {
  const exact = formulas.find((item) => item.formulaName === name)
  if (exact) return exact
  return formulas.find(
    (item) =>
      item.formulaName.includes(name.replace(/汤$/, '')) ||
      name.includes(item.formulaName.replace(/汤$/, '')),
  )
}

export function ReasoningPage() {
  const { scriptMode } = useAppContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const modeParam = searchParams.get('mode')
  const mode: ReasoningMode = isReasoningMode(modeParam) ? modeParam : 'jingfang'
  const [chenfuDataset, setChenfuDataset] = useState<ChenfuReasoningDataset | null>(null)
  const [chenfuError, setChenfuError] = useState<string | null>(null)
  const [dataset, setDataset] = useState<ReasoningDataset | null>(null)
  const [diffPairs, setDiffPairs] = useState<FormulaDiffPair[]>([])
  const [allFormulas, setAllFormulas] = useState<Formula[]>([])
  const [treeId, setTreeId] = useState<string>('')
  const [path, setPath] = useState<DecisionStep[]>([])
  const [result, setResult] = useState<TreeResult | null>(null)
  const [activeNames, setActiveNames] = useState<string[]>([])

  useEffect(() => {
    void Promise.all([loadReasoning(), loadDiffPairs(), loadFormulas()]).then(
      ([reasoning, diffs, formulas]) => {
        setDataset(reasoning)
        setDiffPairs(diffs)
        setAllFormulas(formulas)
        const initialTree = reasoning.trees[0]?.id ?? ''
        setTreeId((current) => current || initialTree)
        const formulaParam = searchParams.get('formula')
        if (formulaParam) {
          setActiveNames([formulaParam])
          setResult({ formulaName: formulaParam })
        }
      },
    )
    // 仅首屏读取 URL；后续由页面内部控制
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formulaParam = searchParams.get('formula')
  useEffect(() => {
    if (mode !== 'jingfang' || !formulaParam || activeNames.includes(formulaParam)) return
    setActiveNames([formulaParam])
    setResult({ formulaName: formulaParam })
  }, [mode, formulaParam, activeNames])

  const needsChenfu = mode !== 'jingfang'
  useEffect(() => {
    if (!needsChenfu || chenfuDataset) return
    let cancelled = false
    loadChenfuReasoning()
      .then((loaded) => {
        if (!cancelled) setChenfuDataset(loaded)
      })
      .catch((error: unknown) => {
        console.error('[reasoning] 加载陈傅病机数据失败', error)
        if (!cancelled) setChenfuError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [needsChenfu, chenfuDataset])

  const writeParams = (params: Record<string, string>, nextMode: ReasoningMode = mode) => {
    setSearchParams({ ...params, mode: nextMode }, { replace: true })
  }

  const tree = useMemo(
    () => dataset?.trees.find((item) => item.id === treeId) ?? null,
    [dataset, treeId],
  )

  const formulasById = useMemo(() => {
    const map = new Map<string, Formula>()
    for (const formula of allFormulas) map.set(formula.id, formula)
    return map
  }, [allFormulas])

  const reasoningCards = useMemo(() => {
    if (!dataset) return []
    const names =
      activeNames.length > 0
        ? activeNames
        : result
          ? splitNames(result.formulaName)
          : []
    return names
      .map((name) => findReasoning(dataset.formulas, name))
      .filter((item): item is FormulaReasoning => Boolean(item))
  }, [dataset, activeNames, result])

  const selectTree = (id: string) => {
    setTreeId(id)
    setPath([])
    setResult(null)
    setActiveNames([])
    writeParams({})
  }

  const handleResult = (next: TreeResult | null) => {
    setResult(next)
    if (next) {
      const names = splitNames(next.formulaName)
      setActiveNames(names)
      if (names[0]) {
        writeParams({ formula: names[0] })
      }
    } else {
      setActiveNames([])
    }
  }

  const selectFormulaByName = (name: string) => {
    setActiveNames([name])
    setResult({ formulaName: name })
    writeParams({ formula: name })
  }

  if (!dataset || !tree) {
    return <p className="text-stone-500">加载辨证推理数据中…</p>
  }

  const chenfuBody = chenfuError ? (
    <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <FontAwesomeIcon icon={faTriangleExclamation} />
      陈傅病机数据加载失败：{chenfuError}。请先运行 npm run data:reasoning 生成 reasoning-chenfu.json。
    </p>
  ) : !chenfuDataset ? (
    <p className="text-stone-500">加载陈傅病机数据中…</p>
  ) : null

  return (
    <div className="space-y-6">
      <DraftBanner />

      <header className="space-y-3">
        <h1 className="font-serif text-2xl font-bold">
          <FontAwesomeIcon icon={faCodeBranch} className="mr-2 text-cinnabar" />
          辨证开方推理
        </h1>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="推理模式">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === mode}
              onClick={() => writeParams({}, item.id)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                item.id === mode
                  ? 'bg-cinnabar text-white shadow-sm'
                  : 'bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-cinnabar-soft'
              }`}
            >
              <FontAwesomeIcon icon={item.icon} className="mr-1.5" />
              {item.label}
            </button>
          ))}
        </div>
        {mode === 'jingfang' && (
          <p className="max-w-3xl text-sm leading-relaxed text-stone-600">
            正向逐步问诊收敛方证，再展开「条文 → 主症 → 功能 → 单味药 → 药性 → 方性」推理链，并以最小差异方对观察加减。
            数据来源：{dataset.source}。
          </p>
        )}
        {mode !== 'jingfang' && (
          <div className="max-w-4xl space-y-1.5 text-sm leading-relaxed text-stone-600">
            <p>
              两派推理起点不同：伤寒金匮以<strong>方证对应</strong>为主，见某组主症即用某方；
              陈士铎、傅青主以<strong>脏腑病机</strong>立论，常先驳「人以为……」的误判，再借五行生克推出病位，然后定治法与方。
              陈傅病案中的辩难是可选环节，男科、石室秘录多数条目直述证治。
            </p>
            <p className="text-xs text-amber-800">
              提示：陈士铎著作含托名成分（如《石室秘录》以「天师曰」「华君曰」，并屡称岐天师、张公、雷公传授）；本页病机链由大模型从原文抽取（ai-draft），
              所有引文均为原文连续片段，但分栏归类未经人工校对。
            </p>
            {chenfuDataset && (
              <p className="text-xs text-stone-400">
                标注进度：
                {(Object.keys(chenfuDataset.stats) as ChenfuReasoningBook[])
                  .map((book) => {
                    const stat = chenfuDataset.stats[book]
                    return `${CHENFU_BOOK_LABELS[book]} ${stat.annotated}/${stat.records}`
                  })
                  .join('，')}
              </p>
            )}
          </div>
        )}
      </header>

      {mode === 'chenfu' &&
        (chenfuBody ?? (
          <ChenfuCaseBrowser
            dataset={chenfuDataset!}
            selectedKey={searchParams.get('case')}
            onSelect={(key) => writeParams({ case: key })}
          />
        ))}

      {mode === 'compare' &&
        (chenfuBody ?? (
          <CompareView
            chenfu={chenfuDataset!}
            reasoning={dataset}
            topicId={searchParams.get('topic')}
            onTopicChange={(topicId) => writeParams({ topic: topicId })}
          />
        ))}

      {mode === 'jingfang' && (
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="min-w-0 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-400">
            病证主题
          </h2>
          <div className="scrollbar-none -mx-3 flex gap-2 overflow-x-auto px-3 py-0.5 sm:mx-0 sm:px-0 lg:block lg:space-y-2 lg:overflow-visible lg:py-0">
            {dataset.trees.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTree(item.id)}
                className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-sm transition lg:block lg:w-full lg:whitespace-normal ${
                  item.id === treeId
                    ? 'bg-cinnabar text-white'
                    : 'bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-cinnabar-soft'
                }`}
              >
                <span className="font-medium">{convertScript(item.title, scriptMode)}</span>
                <span
                  className={`mt-0.5 block text-[11px] ${
                    item.id === treeId ? 'text-white/70' : 'text-stone-400'
                  }`}
                >
                  讲义 p.{item.sourcePage}
                </span>
              </button>
            ))}
          </div>

          <div className="pt-2 lg:pt-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
              十二经方速览
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {dataset.formulas.map((formula) => (
                <button
                  key={formula.formulaName}
                  type="button"
                  onClick={() => selectFormulaByName(formula.formulaName)}
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    activeNames.includes(formula.formulaName)
                      ? 'bg-teal text-white'
                      : 'bg-stone-100 text-stone-600 hover:bg-teal-soft'
                  }`}
                >
                  {convertScript(formula.formulaName, scriptMode)}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-stone-200 bg-white/80 p-3 shadow-sm sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-serif text-lg font-semibold">逐步问诊</h2>
              <button
                type="button"
                className="text-sm text-stone-500 hover:text-cinnabar"
                onClick={() => {
                  setPath([])
                  handleResult(null)
                }}
              >
                <FontAwesomeIcon icon={faRotateLeft} className="mr-1" />
                重置路径
              </button>
            </div>
            <DecisionStepper
              tree={tree}
              path={path}
              onPathChange={setPath}
              onResult={handleResult}
            />
          </section>

          <section>
            <h2 className="mb-2 font-serif text-lg font-semibold">决策树总览</h2>
            <TreeOverview tree={tree} path={path} />
          </section>

          {result && (
            <div className="rounded-xl border border-amber-200 bg-amber-soft px-4 py-3 text-sm text-amber-950">
              {reasoningSafetyNotice(path.map((step) => step.optionLabel)).map((line) => (
                <p key={line} className="flex items-start gap-2">
                  <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" />
                  <span>{line}</span>
                </p>
              ))}
            </div>
          )}

          {result?.addHerbs && result.addHerbs.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-soft px-4 py-3 text-sm text-amber-900">
              加味：{result.addHerbs.map((herb) => convertScript(herb, scriptMode)).join('、')}
              {result.note ? `（${convertScript(result.note, scriptMode)}）` : ''}
            </div>
          )}

          {reasoningCards.length === 0 && result && (
            <div className="rounded-xl border border-stone-200 bg-white px-4 py-5 text-sm text-stone-600">
              已收敛到「{convertScript(result.formulaName, scriptMode)}」，但讲义方解库中暂无完整推理卡片。
              {result.formulaIds?.some(Boolean) && (
                <span className="ml-2">
                  可前往
                  {result.formulaIds
                    .filter(Boolean)
                    .map((id) => (
                      <Link
                        key={id}
                        to={`/formulas/${encodeURIComponent(id!)}`}
                        className="mx-1 text-teal hover:underline"
                      >
                        方剂页
                      </Link>
                    ))}
                  查看组成。
                </span>
              )}
            </div>
          )}

          {reasoningCards.map((card) => (
            <section
              key={card.formulaName}
              className="space-y-4 rounded-2xl border border-stone-200 bg-white/90 p-3 shadow-sm sm:p-4"
            >
              <ReasoningChain formula={card} />
              {reasoningCardVisibility(card.reviewStatus).showNatureChart && (
              <div>
                <h3 className="mb-2 flex items-center gap-2 font-serif text-lg font-semibold">
                  <FontAwesomeIcon icon={faFlask} className="text-teal" />
                  方性指数
                </h3>
                <NatureChart natureIndex={card.natureIndex} formulaName={card.formulaName} />
              </div>
              )}
              <VariantPanel
                formulaId={card.formulaId}
                formulaName={card.formulaName}
                diffPairs={diffPairs}
                formulasById={formulasById}
                onSelectFormulaName={selectFormulaByName}
              />
            </section>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}
