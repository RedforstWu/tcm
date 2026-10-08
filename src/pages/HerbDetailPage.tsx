import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import type {
  Clause,
  Formula,
  FormulaDiffPair,
  Herb,
  HerbMonograph,
  HerbRole,
} from '@/types/data'
import { BOOK_CORPUS } from '@/types/data'
import {
  bookTitle,
  loadAllClauses,
  loadDiffPairs,
  loadFormulas,
  loadHerbRoles,
  loadHerbs,
  loadMonographs,
} from '@/lib/data'
import { convertScript } from '@/lib/text'
import { COMPACT_CHART_GRID, COMPACT_CHART_GRID_WITH_VISUAL_MAP } from '@/lib/chart-layout'
import { useIsCompactScreen } from '@/lib/use-media-query'
import { useAppContext } from '@/context/AppContext'
import { DraftBanner } from '@/components/DraftBanner'
import { FormulaCompareDrawer } from '@/components/FormulaCompareDrawer'

export function HerbDetailPage() {
  const { herbId = '' } = useParams()
  const id = decodeURIComponent(herbId)
  const { scriptMode, corpusFilter } = useAppContext()
  const isCompact = useIsCompactScreen()
  const [herb, setHerb] = useState<Herb | null>(null)
  const [allFormulas, setAllFormulas] = useState<Formula[]>([])
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [diffs, setDiffs] = useState<FormulaDiffPair[]>([])
  const [clauses, setClauses] = useState<Clause[]>([])
  const [roles, setRoles] = useState<HerbRole[]>([])
  const [monograph, setMonograph] = useState<HerbMonograph | null>(null)
  const [openFormulaIds, setOpenFormulaIds] = useState<string[]>([])

  useEffect(() => {
    setOpenFormulaIds([])
    void Promise.all([
      loadHerbs(),
      loadFormulas(),
      loadDiffPairs(),
      loadAllClauses(),
      loadHerbRoles(),
      loadMonographs(),
    ]).then(([herbList, formulaList, diffList, clauseList, roleList, monoList]) => {
      const current = herbList.find((item) => item.id === id) ?? null
      setHerb(current)
      setAllFormulas(formulaList)
      setClauses(clauseList)
      setMonograph(monoList.find((item) => item.herbId === id) ?? null)
      setRoles(roleList.filter((role) => role.herbId === id))
      if (!current) return
      let relatedFormulas = formulaList.filter((formula) =>
        current.formulaIds.includes(formula.id),
      )
      if (corpusFilter !== 'all') {
        relatedFormulas = relatedFormulas.filter(
          (formula) => BOOK_CORPUS[formula.book] === corpusFilter,
        )
      }
      setFormulas(relatedFormulas)
      setDiffs(
        diffList.filter((diff) => {
          if (diff.herbId !== current.id) return false
          if (corpusFilter === 'all') return true
          const from = formulaList.find((f) => f.id === diff.fromId)
          return from ? BOOK_CORPUS[from.book] === corpusFilter : false
        }),
      )
    })
  }, [id, corpusFilter])

  const openFormulas = useCallback((ids: string[]) => {
    setOpenFormulaIds((prev) => {
      const next = [...prev]
      for (const formulaId of ids) {
        if (!next.includes(formulaId)) next.push(formulaId)
      }
      return next
    })
  }, [])

  const removeFormula = useCallback((formulaId: string) => {
    setOpenFormulaIds((prev) => prev.filter((item) => item !== formulaId))
  }, [])

  const closeDrawer = useCallback(() => {
    setOpenFormulaIds([])
  }, [])

  const formulaName = useCallback(
    (formulaId: string) => allFormulas.find((item) => item.id === formulaId)?.name ?? formulaId,
    [allFormulas],
  )

  const formulaById = useMemo(
    () => new Map(allFormulas.map((f) => [f.id, f])),
    [allFormulas],
  )

  const roleClusters = useMemo(() => {
    const map = new Map<string, HerbRole[]>()
    for (const role of roles) {
      const key = role.roleText
      const list = map.get(key) ?? []
      list.push(role)
      map.set(key, list)
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [roles])

  const doseRoleScatter = useMemo(() => {
    const categories = roleClusters.map((item) => item[0]).slice(0, 12)
    const points: Array<[number, number, string]> = []
    for (const role of roles) {
      const formula = formulaById.get(role.formulaId)
      const herbLine = formula?.herbs.find((h) => h.herbId === id)
      const qian = herbLine?.doseQian
      if (qian === undefined) continue
      const y = categories.indexOf(role.roleText)
      if (y < 0) continue
      points.push([qian, y, formula?.name ?? role.formulaId])
    }
    return {
      tooltip: {
        formatter: (params: { data: [number, number, string] }) =>
          `${params.data[2]}<br/>${params.data[0]}钱 · ${categories[params.data[1]]}`,
      },
      grid: isCompact ? COMPACT_CHART_GRID : undefined,
      xAxis: { type: 'value', name: '剂量（钱）' },
      yAxis: { type: 'category', data: categories },
      series: [
        {
          type: 'scatter',
          symbolSize: 12,
          data: points,
          itemStyle: { color: '#0f766e' },
        },
      ],
    }
  }, [roles, roleClusters, formulaById, id, isCompact])

  const doseChart = useMemo(() => {
    const buckets = new Map<string, number>()
    for (const formula of formulas) {
      const herbLine = formula.herbs.find((item) => item.herbId === id)
      if (!herbLine) continue
      const key = herbLine.doseRaw || '未详'
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    const entries = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    return {
      tooltip: { trigger: 'axis' },
      grid: isCompact ? COMPACT_CHART_GRID : undefined,
      xAxis: { type: 'category', data: entries.map((item) => item[0]), axisLabel: { rotate: 30 } },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: entries.map((item) => item[1]), itemStyle: { color: '#b91c1c' } }],
    }
  }, [formulas, id, isCompact])

  const corpusCompare = useMemo(() => {
    const build = (corpus: 'jingfang' | 'chenfu') => {
      const corpusFormulas = formulas.filter((f) => BOOK_CORPUS[f.book] === corpus)
      const tags = new Map<string, number>()
      const cooccur = new Map<string, number>()
      for (const formula of corpusFormulas) {
        for (const other of formula.herbs) {
          if (other.herbId === id) continue
          cooccur.set(other.name, (cooccur.get(other.name) ?? 0) + 1)
        }
        for (const clauseId of formula.sourceClauseIds) {
          const clause = clauses.find((c) => c.id === clauseId)
          if (!clause) continue
          for (const tag of clause.symptomTags) {
            tags.set(tag, (tags.get(tag) ?? 0) + 1)
          }
        }
      }
      return {
        count: corpusFormulas.length,
        symptoms: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
        partners: [...cooccur.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      }
    }
    return { jingfang: build('jingfang'), chenfu: build('chenfu') }
  }, [formulas, clauses, id])

  const liftChart = useMemo(() => {
    const herbTags = new Map<string, number>()
    for (const clause of clauses.filter((item) =>
      formulas.some((formula) => formula.sourceClauseIds.includes(item.id)),
    )) {
      for (const tag of clause.symptomTags) {
        herbTags.set(tag, (herbTags.get(tag) ?? 0) + 1)
      }
    }
    const relatedClauseCount = Math.max(
      new Set(formulas.flatMap((formula) => formula.sourceClauseIds)).size,
      1,
    )
    const rows = [...herbTags.entries()]
      .map(([tag, count]) => ({
        tag,
        rate: count / relatedClauseCount,
        count,
      }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 12)
    return {
      tooltip: { trigger: 'axis' },
      grid: isCompact ? COMPACT_CHART_GRID : undefined,
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: rows.map((row) => row.tag).reverse() },
      series: [
        {
          type: 'bar',
          data: rows.map((row) => Number((row.rate * 100).toFixed(1))).reverse(),
          itemStyle: { color: '#0f766e' },
        },
      ],
    }
  }, [clauses, formulas, isCompact])

  const cooccur = useMemo(() => {
    const counts = new Map<string, number>()
    for (const formula of formulas) {
      for (const other of formula.herbs) {
        if (other.herbId === id) continue
        counts.set(other.name, (counts.get(other.name) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [formulas, id])

  const heatOption = useMemo(() => {
    const names = cooccur.map((item) => item[0])
    return {
      tooltip: { position: 'top' },
      grid: isCompact ? COMPACT_CHART_GRID_WITH_VISUAL_MAP : undefined,
      xAxis: { type: 'category', data: names, axisLabel: { rotate: 40 } },
      yAxis: { type: 'category', data: [herb?.name ?? ''] },
      visualMap: {
        min: 0,
        max: Math.max(...cooccur.map((item) => item[1]), 1),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
      },
      series: [
        {
          type: 'heatmap',
          data: cooccur.map((item, index) => [index, 0, item[1]]),
          label: { show: true },
        },
      ],
    }
  }, [cooccur, herb, isCompact])

  if (!herb) return <p className="text-stone-500">未找到药物。</p>

  return (
    <div className="space-y-4 sm:space-y-6">
      <DraftBanner />
      <div>
        <h1 className="font-serif text-2xl font-bold sm:text-3xl">{convertScript(herb.name, scriptMode)}</h1>
        <p className="text-sm text-stone-500">
          见于 {formulas.length} 方 · 出现 {herb.frequency} 次
          {openFormulaIds.length > 0 && (
            <span className="ml-3 text-teal">对比中 {openFormulaIds.length} 方</span>
          )}
        </p>
        <p className="mt-1 text-xs text-stone-400">点击方名以抽屉打开，可连续点选多方并排对比。</p>
      </div>

      {monograph && (
        <section className="rounded-2xl border border-cinnabar/20 bg-white/80 p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-serif text-lg font-semibold text-cinnabar">本草新编 · 药性</h2>
            <span className="text-xs text-stone-400">陈士铎</span>
          </div>
          <p className="text-sm text-stone-600">
            {[
              monograph.flavor && `味${monograph.flavor}`,
              monograph.nature && `气${monograph.nature}`,
              monograph.toxicity,
              monograph.channels.length > 0 && `入${monograph.channels.join('、')}经`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="prose-classic mt-3 text-sm leading-relaxed text-stone-700">
            {convertScript(monograph.summary, scriptMode)}
          </p>
          {monograph.qa.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-teal">问答 {monograph.qa.length} 则</summary>
              <div className="mt-2 space-y-2">
                {monograph.qa.slice(0, 5).map((item, index) => (
                  <div key={index} className="rounded-xl bg-paper-dark px-3 py-2">
                    <p className="font-medium text-stone-700">问：{item.question}</p>
                    <p className="mt-1 text-stone-600">曰：{item.answer}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {roleClusters.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white/80 p-4 sm:p-5">
          <h2 className="mb-3 font-serif text-lg font-semibold">方解中的作用</h2>
          <div className="space-y-3">
            {roleClusters.slice(0, 12).map(([roleText, list]) => (
              <div key={roleText} className="rounded-xl bg-paper-dark p-3">
                <p className="font-medium text-teal">
                  {roleText} <span className="text-xs text-stone-400">×{list.length}</span>
                </p>
                <ul className="mt-1 space-y-1 text-xs text-stone-600">
                  {list.slice(0, 5).map((role) => (
                    <li key={role.id}>
                      <button
                        type="button"
                        className="text-cinnabar underline"
                        onClick={() => openFormulas([role.formulaId])}
                      >
                        {formulaName(role.formulaId)}
                      </button>
                      ：{role.sourceSentence || role.mechanism || '—'}
                      <span className="ml-1 text-stone-300">[{role.method}]</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {roles.some((r) => formulaById.get(r.formulaId)?.herbs.some((h) => h.doseQian !== undefined)) && (
        <section className="rounded-2xl border border-stone-200 bg-white/80 p-4">
          <h2 className="mb-2 font-serif text-lg font-semibold">剂量与作用</h2>
          <ReactECharts option={doseRoleScatter} style={{ height: 280 }} />
        </section>
      )}

      <section className="rounded-2xl border border-stone-200 bg-white/80 p-4 sm:p-5">
        <h2 className="mb-3 font-serif text-lg font-semibold">经方 · 陈傅对照</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {(
            [
              ['jingfang', '经方', corpusCompare.jingfang],
              ['chenfu', '陈傅', corpusCompare.chenfu],
            ] as const
          ).map(([key, label, data]) => (
            <div key={key} className="rounded-xl bg-paper-dark p-3 text-sm">
              <p className="mb-2 font-medium text-stone-800">
                {label} <span className="text-xs text-stone-400">{data.count} 方</span>
              </p>
              <p className="text-xs text-stone-500">常见证候</p>
              <p className="mb-2 text-stone-700">
                {data.symptoms.map((s) => s[0]).join('、') || '—'}
              </p>
              <p className="text-xs text-stone-500">常见配伍</p>
              <p className="text-stone-700">
                {data.partners.map((p) => p[0]).join('、') || '—'}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
          <h2 className="mb-2 font-serif text-lg font-semibold">剂量分布</h2>
          <ReactECharts option={doseChart} style={{ height: 280 }} />
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
          <h2 className="mb-2 font-serif text-lg font-semibold">症状关联（条文内出现率 %）</h2>
          <ReactECharts option={liftChart} style={{ height: 280 }} />
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white/80 p-4">
        <h2 className="mb-2 font-serif text-lg font-semibold">常见配伍热力</h2>
        <ReactECharts option={heatOption} style={{ height: 220 }} />
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white/80 p-4 sm:p-5">
        <h2 className="mb-3 font-serif text-lg font-semibold">最小差异方剂对</h2>
        {diffs.length === 0 ? (
          <p className="text-sm text-stone-500">暂无仅差此一味的方对，可结合家族图观察。</p>
        ) : (
          <div className="space-y-3">
            {diffs.slice(0, 20).map((diff) => (
              <div key={diff.id} className="rounded-xl bg-paper-dark p-3 text-sm">
                <p className="font-medium text-cinnabar">
                  {diff.kind === 'add'
                    ? '加入'
                    : diff.kind === 'remove'
                      ? '减去'
                      : diff.kind === 'multi'
                        ? '多味异于'
                        : '改剂量'}
                  「
                  {diff.herbName}」
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="text-teal underline"
                    onClick={() => openFormulas([diff.fromId])}
                  >
                    {formulaName(diff.fromId)}
                  </button>
                  <button
                    type="button"
                    className="text-teal underline"
                    onClick={() => openFormulas([diff.toId])}
                  >
                    {formulaName(diff.toId)}
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-teal px-3 py-0.5 text-xs text-white"
                    onClick={() => openFormulas([diff.fromId, diff.toId])}
                  >
                    两方对比
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white/80 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold">含此药方剂</h2>
          <Link to="/formulas" className="text-xs text-teal">
            全部方剂
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {formulas.map((formula) => {
            const active = openFormulaIds.includes(formula.id)
            return (
              <button
                key={formula.id}
                type="button"
                onClick={() => openFormulas([formula.id])}
                className={`rounded-full px-3 py-1 text-sm transition ${
                  active
                    ? 'bg-cinnabar text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-cinnabar-soft hover:text-cinnabar'
                }`}
              >
                {convertScript(formula.name, scriptMode)}
                <span className={`ml-1 text-xs ${active ? 'text-white/80' : 'text-stone-400'}`}>
                  {bookTitle(formula.book)}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <FormulaCompareDrawer
        openIds={openFormulaIds}
        formulas={allFormulas}
        clauses={clauses}
        highlightHerbId={id}
        onClose={closeDrawer}
        onRemove={removeFormula}
      />
    </div>
  )
}
