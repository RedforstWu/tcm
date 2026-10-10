import type { ReviewStatus } from '@/types/data'

export const UNREVIEWED_LABEL_NOTE = '功效与药性尚未校对，暂不展示'

export function reasoningCardVisibility(reviewStatus: ReviewStatus): {
  showFunction: boolean
  showNatures: boolean
  showNatureChart: boolean
  hiddenNote: string | null
} {
  if (reviewStatus === 'reviewed') {
    return {
      showFunction: true,
      showNatures: true,
      showNatureChart: true,
      hiddenNote: null,
    }
  }
  return {
    showFunction: false,
    showNatures: false,
    showNatureChart: false,
    hiddenNote: UNREVIEWED_LABEL_NOTE,
  }
}
