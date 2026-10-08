/**
 * 窄屏下的紧凑 grid 边距。ECharts 6 默认 outerBoundsMode='auto'，
 * 坐标轴标签溢出画布时会自动收缩绘图区，因此这里只需给出最小留白。
 */
export const COMPACT_CHART_GRID = { left: 8, right: 16, top: 32, bottom: 8 }

/** 带底部横向 visualMap 的图表需要为色条预留空间 */
export const COMPACT_CHART_GRID_WITH_VISUAL_MAP = { ...COMPACT_CHART_GRID, bottom: 64 }
