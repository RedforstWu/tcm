import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { ELEMENT_COLORS, ORGAN_ELEMENT, WUXING_ORDER } from '@/lib/chenfu'
import type { OrganRelation, OrganRelationKind, OrganTag, WuxingElement } from '@/types/data'

interface WuxingGraphProps {
  organs: OrganTag[]
  relations: OrganRelation[]
  height?: number
}

const GRAPH_RADIUS = 100
const NODE_SIZE_ACTIVE = 54
const NODE_SIZE_IDLE = 38
const RELATION_CURVENESS = 0.25

const RELATION_STYLES: Record<OrganRelationKind, { color: string; type: 'solid' | 'dashed' }> = {
  生: { color: '#15803d', type: 'solid' },
  克: { color: '#b91c1c', type: 'solid' },
  乘: { color: '#7f1d1d', type: 'solid' },
  侮: { color: '#7c3aed', type: 'solid' },
  移邪: { color: '#ea580c', type: 'dashed' },
}

/** 五行按相生顺序排在正五边形上，木居上方 */
function elementPosition(element: WuxingElement): { x: number; y: number } {
  const index = WUXING_ORDER.indexOf(element)
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / WUXING_ORDER.length
  return { x: GRAPH_RADIUS * Math.cos(angle), y: GRAPH_RADIUS * Math.sin(angle) }
}

function nextElement(element: WuxingElement, step: number): WuxingElement {
  const index = WUXING_ORDER.indexOf(element)
  return WUXING_ORDER[(index + step) % WUXING_ORDER.length]
}

export function WuxingGraph({ organs, relations, height = 260 }: WuxingGraphProps) {
  const option = useMemo(() => {
    const organsByElement = new Map<WuxingElement, OrganTag[]>()
    for (const organ of organs) {
      const element = ORGAN_ELEMENT[organ]
      const list = organsByElement.get(element) ?? []
      if (!list.includes(organ)) list.push(organ)
      organsByElement.set(element, list)
    }

    const nodes = WUXING_ORDER.map((element) => {
      const involved = organsByElement.get(element) ?? []
      const active = involved.length > 0
      return {
        id: element,
        name: element,
        ...elementPosition(element),
        symbolSize: active ? NODE_SIZE_ACTIVE : NODE_SIZE_IDLE,
        label: {
          show: true,
          formatter: active ? `${element}\n${involved.join('·')}` : element,
          color: active ? '#fff' : '#57534e',
          fontSize: active ? 12 : 13,
          fontFamily: 'serif',
          lineHeight: 15,
        },
        itemStyle: {
          color: active ? ELEMENT_COLORS[element] : '#f5f5f4',
          borderColor: ELEMENT_COLORS[element],
          borderWidth: 2,
        },
      }
    })

    const backgroundLinks = WUXING_ORDER.flatMap((element) => [
      {
        source: element,
        target: nextElement(element, 1),
        lineStyle: { color: '#d6d3d1', width: 1, curveness: 0 },
        label: { show: false },
        tooltip: { show: false },
      },
      {
        source: element,
        target: nextElement(element, 2),
        lineStyle: { color: '#e7e5e4', width: 1, type: 'dotted' as const, curveness: 0 },
        label: { show: false },
        tooltip: { show: false },
      },
    ])

    const relationLinks = relations.map((relation) => {
      const sourceElement = ORGAN_ELEMENT[relation.from]
      const targetElement = ORGAN_ELEMENT[relation.to]
      const style = RELATION_STYLES[relation.kind]
      return {
        source: sourceElement,
        target: targetElement,
        relationText: `${relation.from} ${relation.kind} ${relation.to}`,
        symbol: ['none', 'arrow'],
        symbolSize: 10,
        lineStyle: {
          color: style.color,
          width: 2.5,
          type: style.type,
          curveness: sourceElement === targetElement ? 0.8 : RELATION_CURVENESS,
        },
        label: {
          show: true,
          formatter: `${relation.from}${relation.kind}${relation.to}`,
          color: style.color,
          fontSize: 11,
        },
      }
    })

    return {
      tooltip: {
        formatter: (params: { dataType: string; data: { relationText?: string; name?: string } }) =>
          params.dataType === 'edge' ? (params.data.relationText ?? '') : (params.data.name ?? ''),
      },
      series: [
        {
          type: 'graph',
          layout: 'none',
          roam: false,
          edgeSymbol: ['none', 'none'],
          data: nodes,
          links: [...backgroundLinks, ...relationLinks],
          emphasis: { disabled: true },
        },
      ],
    }
  }, [organs, relations])

  return (
    <div>
      <ReactECharts option={option} style={{ height }} notMerge />
      <p className="mt-1 text-center text-[11px] text-stone-400">
        灰实线为相生次序，灰点线为相克次序；彩色箭头为本案原文所述关系
      </p>
    </div>
  )
}
