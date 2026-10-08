/** 清代方剂剂量解析：1 两 = 10 钱 = 100 分 = 1000 厘 */

export const QIAN_PER_LIANG = 10
export const FEN_PER_QIAN = 10
export const LI_PER_FEN = 10
/** 清代库平两约重（克），仅作展示参考 */
export const QING_LIANG_TO_GRAM = 37.3

export interface QingParsedDose {
  doseRaw: string
  doseLiang?: number
  doseQian?: number
  doseCount?: number
  gramsQing?: number
}

const CN_NUM: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  壹: 1,
  二: 2,
  贰: 2,
  兩: 2,
  两: 2,
  三: 3,
  叁: 3,
  參: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  陸: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
  十: 10,
  拾: 10,
  百: 100,
  佰: 100,
  半: 0.5,
}

const NUM_CHARS = '零〇一二贰貳兩两叁三參四五伍六陆陸七柒八捌九玖十拾百佰半壹贰叁肆伍陆柒捌玖拾'

export function parseChineseNumber(raw: string): number | undefined {
  const text = raw.trim()
  if (!text) return undefined
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  if (text === '半') return 0.5

  if (text.includes('半') && text !== '半') {
    const base = text.replace('半', '')
    if (!base) return 0.5
    const baseValue = parseChineseNumber(base)
    return baseValue === undefined ? undefined : baseValue + 0.5
  }

  let total = 0
  let current = 0
  for (const char of text) {
    const value = CN_NUM[char]
    if (value === undefined) return undefined
    if (value === 10 || value === 100) {
      current = (current || 1) * value
      total += current
      current = 0
    } else {
      current = value
    }
  }
  return total + current
}

function extractUnitValue(doseRaw: string, unit: string): number | undefined {
  if (unit === '两' || unit === '兩') {
    const halfMatch = doseRaw.match(
      new RegExp(`([${NUM_CHARS}\\d.]+)?(?:两|兩)半`),
    )
    if (halfMatch) {
      const base = halfMatch[1] ? parseChineseNumber(halfMatch[1]) : 0
      if (base === undefined) return undefined
      return base + 0.5
    }
  }
  const pattern = new RegExp(`([${NUM_CHARS}\\d.]+)(?=${unit})`)
  const match = doseRaw.match(pattern)
  if (!match) return undefined
  return parseChineseNumber(match[1]!)
}

/**
 * 从「白术（一两，土炒）」「人参（二钱）」「壹钱」「叁两」等片段提取剂量原文。
 */
export function extractQingDoseRaw(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return ''
  if (/各?等分/.test(trimmed)) return '等分'

  // 括号内剂量：「白术（一两，土炒）」「白芍（酒炒，五钱）」
  const parenMatches = [...trimmed.matchAll(/[（(]([^）)]+)[）)]/g)]
  for (const paren of parenMatches) {
    const inner = paren[1]!
    const doseInParen = inner.match(
      new RegExp(
        `([${NUM_CHARS}\\d.]+(?:两|兩|钱|錢|分|厘|枚|个|箇|粒|片|茎|把|尺|升|合)(?:半)?(?:[${NUM_CHARS}\\d.]+(?:两|兩|钱|錢|分|厘))?)`,
      ),
    )
    if (doseInParen?.[1]) return doseInParen[1]
  }

  // 括号外：「白术一两」「桂枝各等分」
  const outside = trimmed.match(
    new RegExp(
      `([${NUM_CHARS}\\d.]+(?:两|兩|钱|錢|分|厘|枚|个|箇|粒|片|茎|把|尺|升|合)(?:半)?(?:[${NUM_CHARS}\\d.]+(?:两|兩|钱|錢|分|厘))?)`,
    ),
  )
  if (outside?.[1]) return outside[1]

  return ''
}

export function parseQingDose(rawText: string): QingParsedDose {
  const fragment = extractQingDoseRaw(rawText)
  if (!fragment) {
    return { doseRaw: '' }
  }
  if (fragment === '等分') {
    return { doseRaw: '等分' }
  }

  const doseLiang =
    extractUnitValue(fragment, '两') ?? extractUnitValue(fragment, '兩')
  const doseQianDirect =
    extractUnitValue(fragment, '钱') ?? extractUnitValue(fragment, '錢')
  const doseFen = extractUnitValue(fragment, '分')
  const doseLi = extractUnitValue(fragment, '厘')
  const doseCount =
    extractUnitValue(fragment, '枚') ??
    extractUnitValue(fragment, '个') ??
    extractUnitValue(fragment, '箇') ??
    extractUnitValue(fragment, '粒') ??
    extractUnitValue(fragment, '片')

  let doseQian: number | undefined
  if (doseLiang !== undefined) {
    doseQian = doseLiang * QIAN_PER_LIANG
  }
  if (doseQianDirect !== undefined) {
    doseQian = (doseQian ?? 0) + doseQianDirect
  }
  if (doseFen !== undefined) {
    doseQian = (doseQian ?? 0) + doseFen / FEN_PER_QIAN
  }
  if (doseLi !== undefined) {
    doseQian = (doseQian ?? 0) + doseLi / (FEN_PER_QIAN * LI_PER_FEN)
  }

  const result: QingParsedDose = {
    doseRaw: fragment,
    doseLiang,
    doseQian: doseQian !== undefined ? Number(doseQian.toFixed(3)) : undefined,
    doseCount,
  }

  if (doseLiang !== undefined) {
    result.gramsQing = Number((doseLiang * QING_LIANG_TO_GRAM).toFixed(2))
  } else if (doseQian !== undefined) {
    result.gramsQing = Number(((doseQian / QIAN_PER_LIANG) * QING_LIANG_TO_GRAM).toFixed(2))
  }

  return result
}
