import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Link } from 'react-router-dom'
import type { Formula, FormulaDiffPair, FormulaFamily } from '@/types/data'
import { loadDiffPairs, loadFamilies, loadFormulas } from '@/lib/data'

export function FamilyGraphPage() {
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [families, setFamilies] = useState<FormulaFamily[]>([])
  const [diffs, setDiffs] = useState<FormulaDiffPair[]>([])
  const [selectedFamily, setSelectedFamily] = useState('')
  const [edgeInfo, setEdgeInfo] = useState<FormulaDiffPair | null>(null)

  useEffect(() => {
    void Promise.all([loadFormulas(), loadFamilies(), loadDiffPairs()]).then(
      ([formulaList, familyList, diffList]) => {
        setFormulas(formulaList.filter((item) => item.book === 'songben'))
        setFamilies(familyList.filter((item) => item.formulaIds.some((id) => id.startsWith('songben-'))))
        setDiffs(diffList)
        setSelectedFamily(familyList[0]?.id ?? '')
      },
    )
  }, [])

  const option = useMemo(() => {
    const family = families.find((item) => item.id === selectedFamily)
    const ids = new Set(family?.formulaIds ?? formulas.slice(0, 40).map((item) => item.id))
    const nodes = formulas
      .filter((item) => ids.has(item.id))
      .map((item) => ({
        id: item.id,
        name: item.name,
        symbolSize: 18 + item.herbs.length * 2,
        category: 0,
      }))
    const nodeIdSet = new Set(nodes.map((node) => node.id))
    const links = diffs
      .filter((diff) => nodeIdSet.has(diff.fromId) && nodeIdSet.has(diff.toId))
      .map((diff) => ({
        source: diff.fromId,
        target: diff.toId,
        value: diff.herbName,
        label: { show: true, formatter: diff.herbName, fontSize: 10 },
      }))

    return {
      tooltip: {},
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          data: nodes,
          links,
          label: { show: true, position: 'right', fontSize: 11 },
          force: { repulsion: 180, edgeLength: 90 },
          lineStyle: { color: '#0f766e', curveness: 0.15 },
        },
      ],
    }
  }, [families, formulas, diffs, selectedFamily])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold">方剂家族图</h1>
        <p className="text-sm text-stone-500">边标签为加减/改剂量的药物。点击边可查看差异对详情。</p>
      </div>
      <select
        value={selectedFamily}
        onChange={(event) => setSelectedFamily(event.target.value)}
        className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm"
      >
        {families.map((family) => (
          <option key={family.id} value={family.id}>
            {family.name}（{family.formulaIds.length}）
          </option>
        ))}
      </select>
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <ReactECharts
          option={option}
          style={{ height: 520 }}
          onEvents={{
            click: (params: { dataType?: string; data?: { source?: string; target?: string; value?: string } }) => {
              if (params.dataType !== 'edge' || !params.data?.source || !params.data?.target) return
              const hit =
                diffs.find(
                  (diff) =>
                    diff.fromId === params.data?.source &&
                    diff.toId === params.data?.target &&
                    diff.herbName === params.data?.value,
                ) ?? null
              setEdgeInfo(hit)
            },
          }}
        />
      </div>
      {edgeInfo && (
        <div className="rounded-2xl border border-teal/30 bg-teal-soft/40 p-4 text-sm">
          <p className="font-medium text-teal">
            {edgeInfo.kind === 'add' ? '加' : edgeInfo.kind === 'remove' ? '去' : '改剂量'}：
            {edgeInfo.herbName}
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link className="underline" to={`/formulas/${encodeURIComponent(edgeInfo.fromId)}`}>
              方 A
            </Link>
            <Link className="underline" to={`/formulas/${encodeURIComponent(edgeInfo.toId)}`}>
              方 B
            </Link>
            <Link className="underline" to={`/herbs/${encodeURIComponent(edgeInfo.herbId)}`}>
              查看药物页
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
