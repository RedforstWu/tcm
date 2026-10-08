export interface FloatingPositionInput {
  anchorX: number
  anchorY: number
  floatingWidth: number
  viewportWidth: number
  viewportHeight: number
  /** 锚点与浮层之间的间距 */
  offset?: number
  /** 浮层与视口边缘的最小留白 */
  margin?: number
}

export interface FloatingPosition {
  left: number
  top?: number
  bottom?: number
}

const DEFAULT_OFFSET = 12
const DEFAULT_MARGIN = 8
/** 锚点位于视口下方该比例以下时，浮层改为向上展开 */
const FLIP_UP_RATIO = 0.6

/**
 * 计算以 fixed 定位的浮层位置，保证水平方向不溢出视口；
 * 锚点靠近底部时改用 bottom 向上展开，避免浮层被屏幕下沿截断。
 */
export function computeFloatingPosition({
  anchorX,
  anchorY,
  floatingWidth,
  viewportWidth,
  viewportHeight,
  offset = DEFAULT_OFFSET,
  margin = DEFAULT_MARGIN,
}: FloatingPositionInput): FloatingPosition {
  const width = Math.min(floatingWidth, Math.max(viewportWidth - margin * 2, 0))
  const maxLeft = Math.max(viewportWidth - width - margin, margin)
  const left = Math.min(Math.max(anchorX + offset, margin), maxLeft)

  if (anchorY > viewportHeight * FLIP_UP_RATIO) {
    return { left, bottom: Math.max(viewportHeight - anchorY + offset, margin) }
  }
  return { left, top: Math.max(anchorY + offset, margin) }
}
