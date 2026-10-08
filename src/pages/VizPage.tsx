import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { Clause, Formula, Herb } from '@/types/data'
import { loadClauses, loadFormulas, loadHerbs } from '@/lib/data'
import { COMPACT_CHART_GRID } from '@/lib/chart-layout'
import { useIsCompactScreen } from '@/lib/use-media-query'

const FREQ_CHART_HEIGHT = { regular: 360, compact: 300 }
const PANEL_CHART_HEIGHT = { regular: 420, compact: 360 }

export function VizPage() {
  const isCompact = useIsCompactScreen()
  const [herbs, setHerbs] = useState<Herb[]>([])
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [clauses, setClauses] = useState<Clause[]>([])

  useEffect(() => {
    void Promise.all([loadHerbs(), loadFormulas(), loadClauses('songben')]).then(
      ([herbList, formulaList, clauseList]) => {
        setHerbs(herbList)
        setFormulas(formulaList.filter((item) => item.book === 'songben'))
        setClauses(clauseList)
      },
    )
  }, [])

  const freqOption = useMemo(() => {
    const top = herbs.slice(0, 20)
    return {
      title: { text: '药物使用频次 Top 20', left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {},
      grid: isCompact ? COMPACT_CHART_GRID : undefined,
      xAxis: { type: 'category', data: top.map((item) => item.name), axisLabel: { rotate: 40 } },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: top.map((item) => item.frequency), itemStyle: { color: '#b91c1c' } }],
    }
  }, [herbs, isCompact])

  const sunburstOption = useMemo(() => {
    const chapters = new Map<string, number>()
    for (const clause of clauses) {
      chapters.set(clause.chapter, (chapters.get(clause.chapter) ?? 0) + 1)
    }
    return {
      title: { text: '宋本篇章结构（条文数）', left: 'center', textStyle: { fontSize: 14 } },
      series: {
        type: 'sunburst',
        radius: [0, '90%'],
        data: [
          {
            name: '伤寒论',
            children: [...chapters.entries()].map(([name, value]) => ({ name, value })),
          },
        ],
        label: { rotate: 'radial', fontSize: 10 },
      },
    }
  }, [clauses])

  const matrixOption = useMemo(() => {
    const topHerbs = herbs.slice(0, 15)
    const topFormulas = formulas
      .filter((item) => item.herbs.length > 0)
      .slice(0, 15)
    const data: Array<[number, number, number]> = []
    topFormulas.forEach((formula, fi) => {
      const set = new Set(formula.herbs.map((herb) => herb.herbId))
      topHerbs.forEach((herb, hi) => {
        if (set.has(herb.id)) data.push([hi, fi, 1])
      })
    })
    return {
      title: { text: '药-方共现矩阵（抽样）', left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {
        formatter: (params: { value: number[] }) => {
          const herb = topHerbs[params.value[0]]?.name ?? ''
          const formula = topFormulas[params.value[1]]?.name ?? ''
          return `${formula} × ${herb}`
        },
      },
      grid: isCompact ? COMPACT_CHART_GRID : undefined,
      xAxis: { type: 'category', data: topHerbs.map((item) => item.name), axisLabel: { rotate: 40 } },
      yAxis: { type: 'category', data: topFormulas.map((item) => item.name) },
      visualMap: { min: 0, max: 1, show: false },
      series: [{ type: 'heatmap', data, label: { show: false } }],
    }
  }, [herbs, formulas, isCompact])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold">全局可视化</h1>
        <p className="text-sm text-stone-500">药物频次、篇章旭日图、药-方矩阵。</p>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white p-2 sm:p-3">
        <ReactECharts
          option={freqOption}
          style={{ height: isCompact ? FREQ_CHART_HEIGHT.compact : FREQ_CHART_HEIGHT.regular }}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-2 sm:p-3">
          <ReactECharts
            option={sunburstOption}
            style={{ height: isCompact ? PANEL_CHART_HEIGHT.compact : PANEL_CHART_HEIGHT.regular }}
          />
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-2 sm:p-3">
          <ReactECharts
            option={matrixOption}
            style={{ height: isCompact ? PANEL_CHART_HEIGHT.compact : PANEL_CHART_HEIGHT.regular }}
          />
        </div>
      </div>
    </div>
  )
}
