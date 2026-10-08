/** 东汉考古实测约 15.625 g/两；教材常用折算约 3 g/两 */
export const LIANG_TO_GRAM_ARCHAEOLOGY = 15.625
export const LIANG_TO_GRAM_TEXTBOOK = 3

export function formatDualGrams(doseLiang?: number): string | null {
  if (doseLiang === undefined) return null
  const archaeology = (doseLiang * LIANG_TO_GRAM_ARCHAEOLOGY).toFixed(1)
  const textbook = (doseLiang * LIANG_TO_GRAM_TEXTBOOK).toFixed(1)
  return `${archaeology}g（考古）/ ${textbook}g（教材）`
}
