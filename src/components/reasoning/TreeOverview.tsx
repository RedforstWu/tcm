import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { ReasoningTree } from '@/types/data'
import type { DecisionStep } from './DecisionStepper'

interface TreeOverviewProps {
  tree: ReasoningTree
  path: DecisionStep[]
}

interface EChartsTreeNode {
  name: string
  value?: string
  itemStyle?: { color?: string; borderColor?: string }
  lineStyle?: { color?: string; width?: number }
  label?: { color?: string; fontWeight?: string }
  children?: EChartsTreeNode[]
}

export function TreeOverview({ tree, path }: TreeOverviewProps) {
  const highlight = useMemo(() => {
    const nodeIds = new Set<string>([tree.rootNodeId])
    const edgeLabels = new Set<string>()
    let nodeId = tree.rootNodeId
    for (const step of path) {
      edgeLabels.add(`${step.nodeId}::${step.optionLabel}`)
      nodeIds.add(step.nodeId)
      const option = tree.nodes[step.nodeId]?.options.find((item) => item.label === step.optionLabel)
      if (option?.nextNodeId) {
        nodeIds.add(option.nextNodeId)
        nodeId = option.nextNodeId
      }
    }
    void nodeId
    return { nodeIds, edgeLabels }
  }, [tree, path])

  const option = useMemo(() => {
    const build = (nodeId: string, depth: number): EChartsTreeNode => {
      const node = tree.nodes[nodeId]
      if (!node) return { name: nodeId }
      const active = highlight.nodeIds.has(nodeId)
      return {
        name: depth === 0 ? tree.title : node.question,
        value: nodeId,
        itemStyle: {
          color: active ? '#b91c1c' : '#faf7f2',
          borderColor: active ? '#b91c1c' : '#d6d3d1',
        },
        label: { color: active ? '#b91c1c' : '#57534e', fontWeight: active ? 'bold' : 'normal' },
        children: node.options.map((opt) => {
          const edgeKey = `${nodeId}::${opt.label}`
          const edgeActive = highlight.edgeLabels.has(edgeKey)
          if (opt.nextNodeId) {
            const child = build(opt.nextNodeId, depth + 1)
            return {
              name: opt.label,
              itemStyle: {
                color: edgeActive ? '#0f766e' : '#fff',
                borderColor: edgeActive ? '#0f766e' : '#e7e5e4',
              },
              lineStyle: {
                color: edgeActive ? '#0f766e' : '#d6d3d1',
                width: edgeActive ? 2.5 : 1,
              },
              children: [child],
            }
          }
          return {
            name: `${opt.label}\n→ ${opt.result?.formulaName ?? ''}`,
            itemStyle: {
              color: edgeActive ? '#ccfbf1' : '#fff',
              borderColor: edgeActive ? '#0f766e' : '#e7e5e4',
            },
            lineStyle: {
              color: edgeActive ? '#0f766e' : '#d6d3d1',
              width: edgeActive ? 2.5 : 1,
            },
          }
        }),
      }
    }

    return {
      tooltip: { trigger: 'item', triggerOn: 'mousemove' },
      series: [
        {
          type: 'tree',
          data: [build(tree.rootNodeId, 0)],
          top: '4%',
          left: '8%',
          bottom: '4%',
          right: '28%',
          symbol: 'emptyCircle',
          symbolSize: 8,
          orient: 'LR',
          expandAndCollapse: true,
          initialTreeDepth: 3,
          label: {
            position: 'left',
            verticalAlign: 'middle',
            align: 'right',
            fontSize: 10,
            width: 100,
            overflow: 'truncate',
          },
          leaves: {
            label: {
              position: 'right',
              verticalAlign: 'middle',
              align: 'left',
              fontSize: 10,
              width: 120,
              overflow: 'truncate',
            },
          },
          animationDuration: 400,
          lineStyle: { color: '#d6d3d1', curveness: 0.4 },
        },
      ],
    }
  }, [tree, highlight])

  return (
    <div className="space-y-1">
      <div className="scrollbar-thin overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <div className="min-w-[640px] sm:min-w-0">
          <ReactECharts option={option} style={{ height: 320 }} opts={{ renderer: 'canvas' }} />
        </div>
      </div>
      <p className="text-[11px] text-stone-400 sm:hidden">左右滑动查看完整决策树</p>
    </div>
  )
}
