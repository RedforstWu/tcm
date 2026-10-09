import { CJK, DOSE_BODY } from './cjk.ts'

export interface ParsedDose {
  doseRaw: string
  doseLiang?: number
  doseSheng?: number
  doseCount?: number
  gramsArchaeology?: number
  gramsTextbook?: number
}

/** 东汉考古实测约 15.625 g/两；教材常用折算约 3 g/两 */
export const LIANG_TO_GRAM_ARCHAEOLOGY = 15.625
export const LIANG_TO_GRAM_TEXTBOOK = 3

const CN_NUM: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  百: 100,
  半: 0.5,
}

export const DOSE_BODY_RE = new RegExp(`^(?:各)?(${DOSE_BODY})`)

export function parseChineseNumber(raw: string): number | undefined {
  const text = raw.trim()
  if (!text) return undefined
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  if (text === '半') return 0.5

  if (text.includes('半')) {
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
  // 「一两半」「二两半」：单位后紧跟「半」表示 +0.5
  if (unit === '两') {
    const halfMatch = doseRaw.match(/([一二三四五六七八九十百半两\d.]+)?两半/)
    if (halfMatch) {
      const base = halfMatch[1] ? parseChineseNumber(halfMatch[1]) : 0
      if (base === undefined) return undefined
      return base + 0.5
    }
  }
  const pattern = new RegExp(`([一二三四五六七八九十百半两\\d.]+)(?=${unit})`)
  const match = doseRaw.match(pattern)
  if (!match) return undefined
  return parseChineseNumber(match[1]!)
}

export function tokenHasExplicitDose(token: string): boolean {
  return Boolean(extractDoseRaw(token))
}

/** 「两半」→「一两半」；弹子大→如弹丸大 */
function normalizeDoseFragment(fragment: string): string {
  if (!fragment) return fragment
  if (fragment === '两半' || fragment.startsWith('两半')) return `一${fragment}`
  if (fragment === '如弹子大' || fragment === '弹子大') return '如弹丸大'
  return fragment
}

/** 药名与剂量之间可夹单个炮制动词：牡蛎熬等分 */
const INLINE_PROC = '(?:熬|洗|炙|炮|烧|切|擘|碎|研)?'

/**
 * 从「桂枝三两（去皮）」「细辛（三两）」「半夏等分」拆出剂量。
 * 不会把「半夏」的「半」误认成剂量。
 */
export function extractDoseRaw(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return ''

  const name = `[${CJK}]{1,8}?`

  // 药名非贪婪，避免「乌梅三百枚」被切成「乌梅三」+「百枚」
  const outsideMatch = trimmed.match(
    new RegExp(`^${name}(?:[（(][^）)]*[）)])?${INLINE_PROC}(?:各)?(${DOSE_BODY})`),
  )
  if (outsideMatch?.[1]) return normalizeDoseFragment(outsideMatch[1])

  // 「麻黄（去节）各一两」
  const geAfterParen = trimmed.match(
    new RegExp(`^${name}[（(][^）)]*[）)]各(${DOSE_BODY})`),
  )
  if (geAfterParen?.[1]) return normalizeDoseFragment(geAfterParen[1])

  // 「细辛（三两）」「牡蛎（一两半熬）」：括号内剂量
  const parenMatch = trimmed.match(
    new RegExp(`^${name}[（(](?:各)?(${DOSE_BODY})[^）)]*[）)]`),
  )
  if (parenMatch?.[1]) return normalizeDoseFragment(parenMatch[1])

  // 「麻黄（去节，三钱）」：括号内炮制后的尾部剂量
  const parenTailDose = trimmed.match(
    new RegExp(`^${name}[（(][^）)]*?(${DOSE_BODY})[^）)]*[）)]`),
  )
  if (parenTailDose?.[1]) return normalizeDoseFragment(parenTailDose[1])

  // 括号内「熬令黄色捣丸如弹子大」类描述剂量
  const parenDesc = trimmed.match(
    /[（(][^）)]*(如?(?:弹丸|弹子|鸡子)大)[^）)]*[）)]/,
  )
  if (parenDesc?.[1]) return normalizeDoseFragment(parenDesc[1])

  // 「桂枝一两十六铢（去皮）」
  const classic = trimmed.match(
    new RegExp(`^${name}${INLINE_PROC}(?:各)?(${DOSE_BODY})(?:[（(].*)?$`),
  )
  if (classic?.[1]) return normalizeDoseFragment(classic[1])

  return ''
}

export function parseDose(rawText: string): ParsedDose {
  const fragment = extractDoseRaw(rawText)

  const doseLiang = fragment ? extractUnitValue(fragment, '两') : undefined
  const doseSheng = fragment
    ? (extractUnitValue(fragment, '升') ??
      (fragment.includes('合') ? (extractUnitValue(fragment, '合') ?? 0) / 10 : undefined) ??
      (fragment.includes('斗')
        ? (extractUnitValue(fragment, '斗') ?? 0) * 10
        : undefined))
    : undefined
  const doseCount = fragment
    ? (extractUnitValue(fragment, '枚') ??
      extractUnitValue(fragment, '个') ??
      extractUnitValue(fragment, '箇') ??
      extractUnitValue(fragment, '粒'))
    : undefined

  const result: ParsedDose = {
    doseRaw: fragment,
    doseLiang,
    doseSheng,
    doseCount,
  }

  if (doseLiang !== undefined) {
    result.gramsArchaeology = Number((doseLiang * LIANG_TO_GRAM_ARCHAEOLOGY).toFixed(2))
    result.gramsTextbook = Number((doseLiang * LIANG_TO_GRAM_TEXTBOOK).toFixed(2))
  }

  return result
}

/** 把共享剂量写入「药名[剂量][炮制]」 */
export function injectDoseIntoToken(token: string, dose: string): string {
  const trimmed = token.trim()
  if (!dose) return trimmed
  if (extractDoseRaw(trimmed) && !trimmed.includes('各')) return trimmed
  const match = trimmed.match(new RegExp(`^([${CJK}]{1,8})(.*)$`))
  if (!match) return `${trimmed}${dose}`
  return `${match[1]}${dose}${match[2] ?? ''}`
}
