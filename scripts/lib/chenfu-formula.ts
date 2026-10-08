import type { DerivedFrom, FormulaHerb } from '../../src/types/data.ts'
import {
  applyMissingCharFixes,
  buildHerbLexicon,
  canonicalizeChenfuHerb,
  segmentHerbNames,
} from './herb-lexicon.ts'
import { extractQingDoseRaw, parseQingDose } from './qing-dose.ts'
import { extractProcessing } from './herbs.ts'
import { toSimplifiedChinese } from './wiki.ts'

export interface ChenfuFormulaBlock {
  name: string
  herbs: FormulaHerb[]
  preparation: string
  fangjie: string
  role: 'main' | 'alternate'
  anonymous: boolean
  derivedFrom: DerivedFrom[]
  /** 原文中引出本方的句子 */
  introRaw: string
}

const FORMULA_NAME_RE =
  /([\u4e00-\u9fff]{2,16}?(?:汤|湯|散|丸|膏|煎|饮|飲|丹|醴|酒))/

const PREP_RE =
  /^(?:水煎服|水煎|煎服|温服|冷服|蜜丸|水丸|醋丸|酒送|米饮|食后|食前|空腹)/

const NEXT_CASE_RE =
  /^(?:妇人有|婦人有|人有|冬月伤寒|冬月傷寒|凡人|凡伤寒|凡傷寒|男子有|此症|此病|又一方|又曰)/

function toHerbId(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '')
}

function extractFormulaName(intro: string): { name: string; anonymous: boolean } {
  const simplified = toSimplifiedChinese(intro)
  // 方用完带汤 / 方用加减逍遥散
  const named = simplified.match(
    new RegExp(`方用\\s*${FORMULA_NAME_RE.source}`),
  )
  if (named?.[1]) {
    return { name: named[1].replace(/湯/g, '汤').replace(/飲/g, '饮'), anonymous: false }
  }
  // 名完带汤
  const ming = simplified.match(new RegExp(`(?:名|名曰)\\s*${FORMULA_NAME_RE.source}`))
  if (ming?.[1]) {
    return { name: ming[1].replace(/湯/g, '汤').replace(/飲/g, '饮'), anonymous: false }
  }
  // X亦可用 / 亦佳
  const alt = simplified.match(
    new RegExp(`${FORMULA_NAME_RE.source}\\s*(?:亦可用|亦佳|亦可)`),
  )
  if (alt?.[1]) {
    return { name: alt[1].replace(/湯/g, '汤').replace(/飲/g, '饮'), anonymous: false }
  }
  return { name: '', anonymous: true }
}

function isAlternateIntro(intro: string): boolean {
  return /亦可用|亦佳|亦可|并载|备选用|又一方|又方/.test(toSimplifiedChinese(intro))
}

/**
 * 切分粘连药味行。
 * 「石膏（一两）知母（二钱）麦冬（二两）」→ 各药一段
 * 「甘草人参柴胡栀子（各一钱）」→ 先切共享剂量，再分词
 */
export function splitChenfuHerbLine(line: string, lexicon?: string[]): string[] {
  const fixed = applyMissingCharFixes(toSimplifiedChinese(line))
  const cleaned = fixed.replace(/　/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return []

  // 「各一钱」共享剂量
  const geMatch = cleaned.match(
    /^(.+?)[（(]各\s*([一二三四五六七八九十百半两兩钱錢分厘壹贰叁肆伍陆柒捌玖拾\d.]+(?:两|兩|钱|錢|分|厘)?)[）)]$/,
  )
  if (geMatch) {
    const namesPart = geMatch[1]!.replace(/[（(][^）)]*[）)]/g, '').trim()
    const dose = geMatch[2]!
    const names = segmentHerbNames(namesPart, lexicon)
    if (names.length >= 2) {
      return names.map((name) => `${name}（${dose}）`)
    }
  }

  // 按完整括号切：「药（剂量，炮制）」
  const tokens: string[] = []
  const parenUnit =
    /([\u4e00-\u9fff]{1,12})[（(]([^）)]+)[）)]/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = parenUnit.exec(cleaned)) !== null) {
    const before = cleaned.slice(lastIndex, match.index).trim()
    if (before) {
      // before 可能是无括号药名连写
      const segs = segmentHerbNames(before.replace(/[、，,]/g, ''), lexicon)
      if (segs.length > 0) tokens.push(...segs)
      else tokens.push(before)
    }
    tokens.push(`${match[1]}（${match[2]}）`)
    lastIndex = match.index + match[0].length
  }
  const rest = cleaned.slice(lastIndex).trim()
  if (rest) {
    // 「白朮　茯苓　枳壳（各壹钱）」类：空格分隔 + 尾部各剂量
    const geTail = rest.match(/各\s*([一二三四五六七八九十百半两兩钱錢分厘壹贰叁肆伍陆柒捌玖拾\d.]+(?:两|兩|钱|錢|分|厘)?)/)
    if (geTail) {
      const namesPart = rest.slice(0, geTail.index).replace(/[、，,\s]/g, '')
      const names = segmentHerbNames(namesPart, lexicon)
      if (names.length >= 1) {
        tokens.push(...names.map((n) => `${n}（${geTail[1]}）`))
        return tokens
      }
    }
    for (const part of rest.split(/[、，,\s]+/).filter(Boolean)) {
      const segs = segmentHerbNames(part, lexicon)
      if (segs.length > 1) tokens.push(...segs)
      else tokens.push(part)
    }
  }

  // 「桂枝、干葛、陈皮、甘草各等分」
  if (tokens.length === 0 && /各?等分/.test(cleaned)) {
    const namesPart = cleaned.replace(/各?等分.*$/, '').replace(/[、，,\s]/g, '')
    const names = segmentHerbNames(namesPart, lexicon)
    return names.map((n) => `${n}等分`)
  }

  return tokens
}

export function parseChenfuHerbToken(token: string): FormulaHerb | null {
  const simplified = toSimplifiedChinese(token).trim()
  if (!simplified) return null
  if (PREP_RE.test(simplified)) return null

  const paren = simplified.match(/^(.+?)[（(]([^）)]+)[）)]$/)
  const namePart = paren ? paren[1]! : simplified.replace(extractQingDoseRaw(simplified), '')
  const note = paren ? paren[2] : undefined
  const name = canonicalizeChenfuHerb(namePart)
  if (!name || name.length > 8) return null

  const dose = parseQingDose(simplified)
  const processing = extractProcessing(simplified) ?? (note ? extractProcessing(note) : undefined)

  return {
    herbId: toHerbId(name),
    name,
    rawText: simplified,
    doseRaw: dose.doseRaw,
    doseLiang: dose.doseLiang,
    doseQian: dose.doseQian,
    doseCount: dose.doseCount,
    processing,
    note,
  }
}

export function parseChenfuHerbLine(line: string, lexicon?: string[]): FormulaHerb[] {
  const tokens = splitChenfuHerbLine(line, lexicon)
  const herbs: FormulaHerb[] = []
  for (const token of tokens) {
    const herb = parseChenfuHerbToken(token)
    if (herb) herbs.push(herb)
  }
  return herbs
}

export function extractDerivedFrom(fangjie: string): DerivedFrom[] {
  const text = toSimplifiedChinese(fangjie)
  const results: DerivedFrom[] = []
  const patterns = [
    /此即\s*([\u4e00-\u9fff]{2,12}?(?:汤|散|丸|膏|煎|饮|丹))\s*(?:之)?变方/,
    /(?:即|乃)\s*([\u4e00-\u9fff]{2,12}?(?:汤|散|丸|膏|煎|饮|丹))\s*(?:之)?变方/,
    /([\u4e00-\u9fff]{2,12}?(?:汤|散|丸|膏|煎|饮|丹))\s*之变方/,
    /此方即\s*([\u4e00-\u9fff]{2,12}?(?:汤|散|丸|膏|煎|饮|丹))/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const name = match[1]
      if (!results.some((item) => item.name === name)) {
        results.push({ name })
      }
    }
  }
  return results
}

function looksLikeHerbLine(line: string): boolean {
  const text = toSimplifiedChinese(line).trim()
  if (!text || text.length > 120) return false
  if (PREP_RE.test(text)) return false
  if (NEXT_CASE_RE.test(text)) return false
  if (/方用|亦可用|亦佳/.test(text) && FORMULA_NAME_RE.test(text) && text.length < 30) {
    return false
  }
  // 有剂量括号或剂量单位
  if (/[（(][^）)]*(?:两|兩|钱|錢|分|厘|枚)[^）)]*[）)]/.test(text)) return true
  if (/(?:两|兩|钱|錢|分|厘|枚|等分)/.test(text) && text.length < 80) return true
  // 短行药名并列
  if (text.length < 40 && /[\u4e00-\u9fff]{2}/.test(text) && !/(?:治法|谁知|人以为|水煎)/.test(text)) {
    return true
  }
  return false
}

function looksLikeFangjieStart(line: string): boolean {
  const text = toSimplifiedChinese(line)
  return (
    /此方|此即|夫.{0,6}之立法|盖|寓补|用.{1,6}以|益之以|至于|所以|方中/.test(text) ||
    (text.length > 40 && /补|泻|散|升|清|温|利/.test(text) && !looksLikeHerbLine(text))
  )
}

/**
 * 从一条（则）正文中提取全部方剂块。
 */
export function extractChenfuFormulaBlocks(
  body: string,
  options?: { anonymousPrefix?: string; lexicon?: string[] },
): ChenfuFormulaBlock[] {
  const simplified = applyMissingCharFixes(toSimplifiedChinese(body))
  const lexicon = options?.lexicon ?? buildHerbLexicon()
  const lines = simplified
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const blocks: ChenfuFormulaBlock[] = []
  let i = 0
  let formulaIndex = 0

  while (i < lines.length) {
    const line = lines[i]!
    const isFangYong =
      /^方用/.test(line) ||
      /方用[:：∶]/.test(line) ||
      /方用\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/.test(line) ||
      /(?:汤|湯|散|丸|膏|煎|饮|飲|丹)\s*(?:亦可用|亦佳)/.test(line)

    // 「方用」单独一行，或「方用完带汤。」同一行后接药味
    if (!isFangYong && line !== '方用∶' && line !== '方用:' && line !== '方用：') {
      // 男科常见「方用」后直接药味同行：「方用\n桂枝...」已覆盖；「必然发热，方用」行末
      if (!/方用\s*$/.test(line) && !/方用$/.test(line)) {
        i += 1
        continue
      }
    }

    const introRaw = line
    const { name: detectedName, anonymous } = extractFormulaName(introRaw)
    formulaIndex += 1
    const role = isAlternateIntro(introRaw) || blocks.length > 0 ? 'main' : 'main'
    // 第一条为主方；后续含「亦可」为备选；无「亦可」但同则第二方也标 alternate
    const resolvedRole: 'main' | 'alternate' =
      blocks.length === 0 ? 'main' : isAlternateIntro(introRaw) || true ? (blocks.length === 0 ? 'main' : 'alternate') : 'main'

    i += 1
    // 若「方用完带汤。」后正文继续，药味可能在同行后半或下行
    const sameLineRest = introRaw.replace(/^.*?方用[:：∶]?\s*/, '').replace(FORMULA_NAME_RE, '').trim()

    const herbLines: string[] = []
    const prepLines: string[] = []
    const fangjieLines: string[] = []
    let phase: 'herbs' | 'prep' | 'fangjie' = 'herbs'

    if (sameLineRest && looksLikeHerbLine(sameLineRest)) {
      herbLines.push(sameLineRest)
    }

    while (i < lines.length) {
      const current = lines[i]!
      if (/^方用/.test(current) || /方用[:：∶]/.test(current)) break
      if (/(?:汤|湯|散|丸)\s*(?:亦可用|亦佳)/.test(current) && current.length < 40) break
      if (NEXT_CASE_RE.test(current) && herbLines.length > 0) break
      // 页码噪声
      if (/^\d+頁$|^\d+页$/.test(current)) {
        i += 1
        continue
      }

      if (phase === 'herbs') {
        if (PREP_RE.test(current) || /剂轻|剂止|剂愈|剂而/.test(current)) {
          phase = 'prep'
          // 煎服法与方解常同一行：「水煎服。二剂轻……此方……」
          const fangjieSplit = current.split(/(?=(?:此方|此即|夫.{0,8}之立法|盖|寓补|用[\u4e00-\u9fff]{1,6}以))/)
          if (fangjieSplit.length > 1) {
            prepLines.push(fangjieSplit[0]!)
            phase = 'fangjie'
            fangjieLines.push(...fangjieSplit.slice(1))
          } else {
            prepLines.push(current)
          }
        } else if (looksLikeFangjieStart(current) && herbLines.length > 0) {
          phase = 'fangjie'
          fangjieLines.push(current)
        } else if (looksLikeHerbLine(current)) {
          herbLines.push(current)
        } else if (herbLines.length > 0 && current.length > 20) {
          phase = 'fangjie'
          fangjieLines.push(current)
        } else if (herbLines.length === 0 && current.length < 60) {
          herbLines.push(current)
        } else {
          prepLines.push(current)
        }
      } else if (phase === 'prep') {
        if (looksLikeFangjieStart(current) || (current.length > 30 && !PREP_RE.test(current))) {
          phase = 'fangjie'
          fangjieLines.push(current)
        } else {
          const fangjieSplit = current.split(/(?=(?:此方|此即|夫.{0,8}之立法|盖|寓补))/)
          if (fangjieSplit.length > 1) {
            prepLines.push(fangjieSplit[0]!)
            phase = 'fangjie'
            fangjieLines.push(...fangjieSplit.slice(1))
          } else {
            prepLines.push(current)
          }
        }
      } else {
        if (NEXT_CASE_RE.test(current)) break
        fangjieLines.push(current)
      }
      i += 1
    }

    let herbs = herbLines.flatMap((item) => parseChenfuHerbLine(item, lexicon))
    // 去重同名（保留首次）
    const seen = new Set<string>()
    herbs = herbs.filter((herb) => {
      if (seen.has(herb.herbId)) return false
      seen.add(herb.herbId)
      return true
    })

    const preparation = prepLines.join('')
    const fangjie = fangjieLines.join('')
    if (herbs.length === 0 && !fangjie && !preparation) continue

    let name = detectedName
    if (!name) {
      const prefix = options?.anonymousPrefix ?? '无名方'
      name = `${prefix}·方${formulaIndex}`
    }

    // 修正 role：第一张 main，其余 alternate（除非明确「亦可用」也是 alternate）
    const finalRole: 'main' | 'alternate' = blocks.length === 0 ? 'main' : 'alternate'
    void role
    void resolvedRole

    blocks.push({
      name,
      herbs,
      preparation,
      fangjie,
      role: finalRole,
      anonymous: anonymous || !detectedName,
      derivedFrom: extractDerivedFrom(fangjie),
      introRaw,
    })
  }

  return blocks
}
