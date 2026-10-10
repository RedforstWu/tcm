const SEEK_CARE = '请就医，遵医嘱。此处按讲义症状检索方剂，不能代替诊疗。本站不提供剂量与禁忌。'
const MENSTRUAL = '经期用药须由医师决定。'

export function reasoningSafetyNotice(pathLabels: string[]): string[] {
  const notices = [SEEK_CARE]
  if (pathLabels.some((label) => label.includes('月经') || label.includes('经期'))) {
    notices.push(MENSTRUAL)
  }
  return notices
}
