import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { NatureIndex } from '@/types/data'

const AXES: Array<keyof NatureIndex> = [
  '热',
  '寒',
  '补',
  '泻',
  '升',
  '降',
  '收',
  '散',
  '润',
  '燥',
]

interface NatureChartProps {
  natureIndex: NatureIndex
  formulaName: string
}

export function NatureChart({ natureIndex, formulaName }: NatureChartProps) {
  const radarOption = useMemo(
    () => ({
      title: {
        text: `${formulaName}方性图`,
        left: 'center',
        textStyle: { fontSize: 14, fontFamily: 'serif' },
      },
      tooltip: {},
      radar: {
        indicator: AXES.map((name) => ({ name, max: 1 })),
        radius: '62%',
        axisName: { color: '#57534e', fontSize: 11 },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: AXES.map((key) => Number(natureIndex[key].toFixed(4))),
              name: '方性指数',
              areaStyle: { color: 'rgba(185, 28, 28, 0.18)' },
              lineStyle: { color: '#b91c1c' },
              itemStyle: { color: '#b91c1c' },
            },
          ],
        },
      ],
    }),
    [natureIndex, formulaName],
  )

  const barOption = useMemo(
    () => ({
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 16, top: 24, bottom: 32 },
      xAxis: {
        type: 'category',
        data: AXES,
        axisLabel: { fontSize: 11 },
      },
      yAxis: { type: 'value', max: 1, min: 0 },
      series: [
        {
          type: 'bar',
          data: AXES.map((key, index) => ({
            value: Number(natureIndex[key].toFixed(4)),
            itemStyle: {
              color: ['#b91c1c', '#0ea5e9', '#a16207', '#7c3aed', '#0369a1'][
                Math.floor(index / 2)
              ],
            },
          })),
        },
      ],
    }),
    [natureIndex],
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-stone-200 bg-white p-2">
        <ReactECharts option={radarOption} style={{ height: 280 }} />
      </div>
      <div className="rounded-xl border border-stone-200 bg-white p-2">
        <ReactECharts option={barOption} style={{ height: 280 }} />
      </div>
    </div>
  )
}
