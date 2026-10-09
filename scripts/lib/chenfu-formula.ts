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

/** 贪婪匹配，避免「人参竹叶石膏汤」被「膏」提前截成「人参竹叶石膏」 */
const FORMULA_NAME_RE =
  /([\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|煎|饮|飲|丹|醴|酒|膏))/

const PREP_RE =
  /^(?:水煎服|水煎|煎服|温服|冷服|蜜丸|水丸|醋丸|酒送|米饮|食后|食前|空腹|各为细末|各为末|蜜为丸|与酒同煎)/

const NEXT_CASE_RE =
  /^(?:妇人有|婦人有|人有|冬月伤寒|冬月傷寒|凡人|凡伤寒|凡傷寒|男子有|此症|此病|又一方|又曰|一方)/

/** 「补中益气汤∶人参（三钱）…」「∶人参…」中药味前的方名与冒号 */
const LEADING_LABEL_RE = /^[^（(]*?[:：∶]\s*/

/** 药味行尾粘连的煎服法/丸散制法起点：「…桂枝（三分）水煎服。一剂而…」「…杜仲（六两）各为细末，蜜为丸…」 */
const INLINE_PREP_START_RE =
  /水煎|煎服|水煮|酒煎|各为细末|各为末|为细末|为末|蜜为丸|与酒同煎|再煎一碗|灌之|一时辰|使强有力|听其自醒|水十碗|锅熬|煎数沸|三味煎|[一二三四五六七八九十]+剂而/

/** 煎药溶媒，几乎每方都用，不列入药味 */
const EXCLUDED_SOLVENT_NAMES = new Set(['水'])

const CJK_CHAR_RE = /[\u3400-\u9fff]/

const SAME_LINE_DOSE_RE = /(?:两|兩|钱|錢|分|厘|枚|片|粒|等分)/

/** 方名后的评价/用法尾语：亦效、亦佳、亦神效、甚妙、殊验、治之亦神、长服亦佳…… */
const ALTERNATE_TAIL = '(?:亦|甚|殊|实|颇|大效|治之|救之|长服|外治|加减)'
const ALTERNATE_INTRO_RE = new RegExp(`(?:汤|湯|散|丸|膏|煎|饮|飲|丹)\\s*${ALTERNATE_TAIL}`)
/** 备选方引语都是短句；长句中的「X汤亦……」多为方解论述 */
const MAX_ALTERNATE_INTRO_LENGTH = 40

function toHerbId(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '')
}

/** 「此症用济阳汤亦可」「此症亦可用加味六君子汤治之」中方名前的引语；「宜春汤」不剥「宜」 */
const FORMULA_NAME_LEAD_RE =
  /^(?:此(?:症|病|证|疟|方即|即))?(?:亦可用|可用|用)?/
/** 「再服调正汤」「先服清骨散」「宜用十全阴疳散」等服法冠称 */
const FORMULA_DOSE_LEAD_RE =
  /^(?:再服|先服|后服|又服|兼服|仍服|急服|频服|连服|宜服|宜用|当用|只用|必用|方名|有宜用)/
const MIN_FORMULA_NAME_LENGTH = 2

/** 误抽方名：叙述残片、制法、整句备选引语 */
const JUNK_FORMULA_NAME_RE =
  /^(?:亦可用|可用|症亦可用|蜜为丸|蜜煮|乎尽|半月健)|之(?:汤|散|丸|膏|煎|饮|丹)$|等(?:汤|散|丸)$|以助|以泻|以补|以散|以消|以升|以降|捣散$/

export function normalizeChenfuFormulaName(raw: string): string {
  const name = raw.replace(/湯/g, '汤').replace(/飲/g, '饮')
  let stripped = name.replace(FORMULA_NAME_LEAD_RE, '')
  stripped = stripped.replace(FORMULA_DOSE_LEAD_RE, '')
  stripped = stripped.replace(/摈榔/g, '槟榔')
  return stripped.length >= MIN_FORMULA_NAME_LENGTH ? stripped : name
}

export function isJunkChenfuFormulaName(name: string): boolean {
  const n = toSimplifiedChinese(name).replace(/湯/g, '汤').replace(/飲/g, '饮').trim()
  if (!n || n.length < 2) return true
  if (JUNK_FORMULA_NAME_RE.test(n)) return true
  if (/^(?:汤|散|丸|膏|煎|饮|丹)$/.test(n)) return true
  return false
}

/** ◎加参生化汤： / 方用肠宁汤。 / 方名助仙丹。 / 宜用十全阴疳散。 */
function isFormulaHeaderLine(line: string): boolean {
  const text = toSimplifiedChinese(line).trim()
  if (/^◎/.test(text)) return FORMULA_NAME_RE.test(text)
  if (
    /^方用/.test(text) ||
    /方用[:：∶]/.test(text) ||
    /方用\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/.test(text) ||
    /(?:此方名|方名)\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/.test(text) ||
    /(?:汤|湯|散|丸|膏|煎|饮|飲|丹)\s*(?:亦可用|亦佳)/.test(text) ||
    /(?:亦可用|可用)\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/.test(text) ||
    // 「此症用破颜丹」「改用清肃汤」「名为三星汤」「余劝其单服二白散」
    /(?:此症可用|此病可用|此症用|此病用|此证用|改用|名为|名曰|单服)\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/.test(
      text,
    ) ||
    // 「七星汤，治传染…」
    (text.length <= 60 &&
      /^[\u4e00-\u9fff]{2,12}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)\s*[，,]\s*治/.test(text)) ||
    isAlternateIntroLine(text)
  ) {
    return true
  }
  // 「宜用/再服/先服」：短行，或长叙述但方名落在行末（…宜用十全阴疳散。）
  if (
    /(?:有宜用|宜用|宜服|再服|先服|必用)\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)\s*[。．]?$/.test(
      text,
    ) ||
    (text.length <= 48 &&
      /(?:有宜用|宜用|宜服|再服|先服|必用)\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/.test(
        text,
      ))
  ) {
    return true
  }
  if (/方用\s*$/.test(text) || /方用$/.test(text)) return true
  if (text === '方用∶' || text === '方用:' || text === '方用：') return true
  return false
}

/** 药味消费中遇下一张方头则停；含行中「……。方用肠宁汤。」「……，宜用十全阴疳散。」 */
function nextFormulaHeaderIndex(line: string): number {
  const text = toSimplifiedChinese(line)
  const trimmed = text.trim()
  if (
    /^◎/.test(trimmed) ||
    /^方用/.test(trimmed) ||
    /^(?:此方名|方名)/.test(trimmed) ||
    /^(?:此症可用|此病可用|此症用|此病用|此证用|改用|名为|名曰|单服)\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/.test(
      trimmed,
    ) ||
    /^(?:内治亦可用|亦可用|可用)\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/.test(
      trimmed,
    ) ||
    /单服\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/.test(trimmed) ||
    /^(?:有宜用|宜用|宜服|再服|先服|必用)\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/.test(
      trimmed,
    ) ||
    (trimmed.length <= 60 &&
      /^[\u4e00-\u9fff]{2,12}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)\s*[，,]\s*治/.test(trimmed))
  ) {
    return 0
  }
  const punct = text.search(
    /[。；，]\s*(?:方用|此方名|方名|◎|此症可用|此症用|此病用|改用|内治亦可用|亦可用|宜用|再服|先服|必用|有宜用)\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/,
  )
  if (punct >= 0) return punct
  // 「余劝其单服二白散，用∶…」——单服不一定紧贴标点
  return text.search(
    /单服\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/,
  )
}

function extractFormulaName(intro: string): { name: string; anonymous: boolean } {
  const simplified = toSimplifiedChinese(intro)
  // ◎加参生化汤：治产后…
  const circled = simplified.match(
    new RegExp(`◎\\s*${FORMULA_NAME_RE.source}`),
  )
  if (circled?.[1]) {
    return { name: normalizeChenfuFormulaName(circled[1]), anonymous: false }
  }
  // 取最后一次「方用X汤」，避免长段叙述中误吞
  const fangYongGlobal = new RegExp(`方用\\s*${FORMULA_NAME_RE.source}`, 'g')
  let fangYongMatch: RegExpExecArray | null = null
  let cursor: RegExpExecArray | null
  while ((cursor = fangYongGlobal.exec(simplified)) !== null) fangYongMatch = cursor
  if (fangYongMatch?.[1]) {
    return { name: normalizeChenfuFormulaName(fangYongMatch[1]), anonymous: false }
  }
  // 此方名收黑虎汤 / 方名助仙丹
  const fangMing = simplified.match(
    new RegExp(`(?:此方名|方名)\\s*${FORMULA_NAME_RE.source}`),
  )
  if (fangMing?.[1]) {
    return { name: normalizeChenfuFormulaName(fangMing[1]), anonymous: false }
  }
  // 宜用十全阴疳散 / 再服调正汤 / 先服清骨散 / 有宜用倍参补中益气汤
  const yiYong = simplified.match(
    new RegExp(
      `(?:有宜用|宜用|宜服|再服|先服|必用)\\s*${FORMULA_NAME_RE.source}`,
    ),
  )
  if (yiYong?.[1]) {
    return { name: normalizeChenfuFormulaName(yiYong[1]), anonymous: false }
  }
  // 此症用破颜丹 / 改用清肃汤 / 单服二白散
  const ciZhengYong = simplified.match(
    new RegExp(
      `(?:此症用|此病用|此证用|改用|单服)\\s*${FORMULA_NAME_RE.source}`,
    ),
  )
  if (ciZhengYong?.[1]) {
    return { name: normalizeChenfuFormulaName(ciZhengYong[1]), anonymous: false }
  }
  // 内治亦可用安宁饮 / 此症亦可用加味六君子汤治之 / 亦可用三奇汤
  const yiKeYong = simplified.match(
    new RegExp(`(?:内治亦可用|亦可用|可用)\\s*${FORMULA_NAME_RE.source}`),
  )
  if (yiKeYong?.[1]) {
    return { name: normalizeChenfuFormulaName(yiKeYong[1]), anonymous: false }
  }
  // 名完带汤 / 名为三星汤
  const ming = simplified.match(
    new RegExp(`(?:名为|名曰|名)\\s*${FORMULA_NAME_RE.source}`),
  )
  if (ming?.[1]) {
    return { name: normalizeChenfuFormulaName(ming[1]), anonymous: false }
  }
  // 七星汤，治传染…
  const bareTreat = simplified.match(
    new RegExp(`^${FORMULA_NAME_RE.source}\\s*[，,]\\s*治`),
  )
  if (bareTreat?.[1]) {
    return { name: normalizeChenfuFormulaName(bareTreat[1]), anonymous: false }
  }
  // 此症用化痞膏外治亦可 / 温正汤亦可用
  const alt = simplified.match(
    new RegExp(`${FORMULA_NAME_RE.source}\\s*${ALTERNATE_TAIL}`),
  )
  if (alt?.[1]) {
    return { name: normalizeChenfuFormulaName(alt[1]), anonymous: false }
  }
  return { name: '', anonymous: true }
}

/** 「此症用两援汤亦可治。」「定乱汤亦神。」「救败散亦效如响。」这类单独成行的备选方引语 */
export function isAlternateIntroLine(line: string): boolean {
  const text = toSimplifiedChinese(line).trim()
  return (
    text.length < MAX_ALTERNATE_INTRO_LENGTH &&
    !/[（(]/.test(text) &&
    ALTERNATE_INTRO_RE.test(text)
  )
}

function isAlternateIntro(intro: string): boolean {
  return (
    /亦可用|亦佳|亦可|并载|备选用|又一方|又方/.test(toSimplifiedChinese(intro)) ||
    isAlternateIntroLine(intro)
  )
}

/**
 * 切分粘连药味行。
 * 「石膏（一两）知母（二钱）麦冬（二两）」→ 各药一段
 * 「甘草人参柴胡栀子（各一钱）」→ 先切共享剂量，再分词
 */
export function splitChenfuHerbLine(line: string, lexicon?: string[]): string[] {
  const fixed = applyMissingCharFixes(toSimplifiedChinese(line))
  const normalized = fixed
    .replace(/[［[]/g, '（')
    .replace(/[］\]]/g, '）')
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_LABEL_RE, '')
  const prepStart = normalized.search(INLINE_PREP_START_RE)
  const cleaned = (prepStart >= 0 ? normalized.slice(0, prepStart) : normalized).trim()
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
    const beforeNames = before ? segmentHerbNames(before.replace(/[、，,]/g, ''), lexicon) : []
    // 「当归人参白术（各一两）」「人参 柴胡 陈皮 甘草（ 各壹钱）」：各 统摄上一剂量之后的全部药味
    const sharedDose = match[2]!.trim().match(/^各\s*(.+)$/)
    const sharedNames = sharedDose ? [...beforeNames, ...segmentHerbNames(match[1]!, lexicon)] : []
    if (sharedDose && sharedNames.length >= 2) {
      tokens.push(...sharedNames.map((name) => `${name}（${sharedDose[1]}）`))
    } else {
      if (beforeNames.length > 0) tokens.push(...beforeNames)
      else if (before) tokens.push(before)
      tokens.push(`${match[1]}（${match[2]}）`)
    }
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
    for (const part of mergeSingleCharParts(rest.split(/[、，,\s]+/).filter(Boolean))) {
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
  if (!CJK_CHAR_RE.test(name)) return null
  if (EXCLUDED_SOLVENT_NAMES.has(name)) return null

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

/** 「柴、胡、黄、芩」原文逐字加顿号：相邻单字段先拼回再分词 */
function mergeSingleCharParts(parts: string[]): string[] {
  const merged: string[] = []
  let singleCharBuffer = ''
  for (const part of parts) {
    if (part.length === 1) {
      singleCharBuffer += part
      continue
    }
    if (singleCharBuffer) merged.push(singleCharBuffer)
    singleCharBuffer = ''
    merged.push(part)
  }
  if (singleCharBuffer) merged.push(singleCharBuffer)
  return merged
}

/** 无剂量、不在词典里的段若含这些叙述/制法字，判为混入药味行的正文（灌之、不死、为丸、煎汤、再服十剂） */
const NARRATIVE_TOKEN_RE =
  /[之也矣愈若倘必不而再每次服煎为如用送调研碗滚妙效病治方剂同可只后]|^(?:子大|空心|开水|滚水|米饭|以上|味共|去粗|土炒|酒炒|酒洗|去皮|细末|如桐)$/

const lexiconSetByList = new WeakMap<string[], Set<string>>()

function lexiconSetOf(lexicon: string[]): Set<string> {
  let lexiconSet = lexiconSetByList.get(lexicon)
  if (!lexiconSet) {
    lexiconSet = new Set(lexicon)
    lexiconSetByList.set(lexicon, lexiconSet)
  }
  return lexiconSet
}

function isNarrativeNoiseHerb(herb: FormulaHerb, lexiconSet: Set<string>): boolean {
  if (herb.doseRaw || herb.note) return false
  if (lexiconSet.has(herb.name)) return false
  return herb.name.length === 1 || NARRATIVE_TOKEN_RE.test(herb.name)
}

export function parseChenfuHerbLine(line: string, lexicon?: string[]): FormulaHerb[] {
  const tokens = splitChenfuHerbLine(line, lexicon)
  const lexiconSet = lexiconSetOf(lexicon ?? buildHerbLexicon())
  const herbs: FormulaHerb[] = []
  for (const token of tokens) {
    const herb = parseChenfuHerbToken(token)
    if (herb && !isNarrativeNoiseHerb(herb, lexiconSet)) herbs.push(herb)
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
  if (!text) return false
  if (PREP_RE.test(text)) return false
  if (NEXT_CASE_RE.test(text)) return false
  // 煎服/外治溶媒行，勿当药味
  if (
    /^水[一二三四五六七八九十百]+(?:碗|盏|钟|杯|锺)/.test(text) ||
    /^去渣|^先薰|^日[一二三四五六七八九十]|^上为细末|^为细末/.test(text)
  ) {
    return false
  }
  if (/方用|亦可用|亦佳/.test(text) && FORMULA_NAME_RE.test(text) && text.length < 30) {
    return false
  }
  // 「用∶人参（二两）…」下一行药列；剂量括号优先于行长限制（丸散长方常超 120 字）
  if (/^用[:：∶]/.test(text)) return true
  if (/[（(][^）)]*(?:两|兩|钱|錢|分|厘|枚|斤|两半|半斤)[^）)]*[）)]/.test(text)) return true
  if (text.length > 120) return false
  if (/(?:两|兩|钱|錢|分|厘|枚|等分)/.test(text) && text.length < 80) return true
  // 短行药名并列
  if (
    text.length < 40 &&
    /[\u4e00-\u9fff]{2}/.test(text) &&
    !/(?:治法|谁知|人以为|水煎|治之|亦可|亦佳|此症|此病|去渣|薰洗)/.test(text)
  ) {
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
    if (!isFormulaHeaderLine(line)) {
      i += 1
      continue
    }

    const introRaw = line
    const extracted = extractFormulaName(introRaw)
    const detectedName = extracted.name
    let anonymous = extracted.anonymous
    formulaIndex += 1
    const role = isAlternateIntro(introRaw) || blocks.length > 0 ? 'main' : 'main'
    // 第一条为主方；后续含「亦可」为备选；无「亦可」但同则第二方也标 alternate
    const resolvedRole: 'main' | 'alternate' =
      blocks.length === 0 ? 'main' : isAlternateIntro(introRaw) || true ? (blocks.length === 0 ? 'main' : 'alternate') : 'main'

    i += 1
    // 若「方用完带汤。」后正文继续，药味可能在同行后半或下行
    // 取末次「方用/◎/方名/宜用」之后余文，关联下行「用∶药列」
    const headerMark = introRaw.match(
      /(?:◎|方用|此方名|方名|此症可用|此病可用|此症用|此病用|此证用|改用|名为|名曰|单服|内治亦可用|亦可用|可用|有宜用|宜用|宜服|再服|先服|必用)[:：∶]?\s*/,
    )
    const headerIdx = headerMark?.index ?? introRaw.lastIndexOf('方用')
    const afterHeader =
      headerIdx >= 0
        ? introRaw
            .slice(headerIdx)
            .replace(
              /^(?:◎|方用|此方名|方名|此症可用|此病可用|此症用|此病用|此证用|改用|名为|名曰|单服|内治亦可用|亦可用|可用|有宜用|宜用|宜服|再服|先服|必用)[:：∶]?\s*/,
              '',
            )
        : introRaw
    // 「◎加参生化汤：治产后…」标题行说明文字不是药味
    // 「龙齿安神丹，亦人参 麦冬（各一两）」——逗号后误粘「亦」再接药列
    // 只剥开头已识别的方名，勿全局删「三味煎」等以煎结尾的制法词
    let sameLineRest = afterHeader
    if (detectedName) {
      sameLineRest = sameLineRest.replace(detectedName, '')
    }
    sameLineRest = sameLineRest
      .replace(/^[:：∶]\s*/, '')
      .replace(/^治[^\n（(]{0,40}/, '')
      .replace(/^[，,。；]\s*亦(?=[\u4e00-\u9fff]{2})/, '')
      .replace(/^[，,。；]\s*/, '')
      .replace(/^(?:亦可外治|外治|甚效|亦效|亦佳|长服亦佳|长服亦甚佳)[^\n（(]{0,20}/, '')
      .replace(/^用[:：∶]\s*/, '')
      // 「磨为细末，入白糖…」制法勿入药列
      .replace(/各炒.*$/, '')
      .replace(/磨为细末.*$/, '')
      .trim()

    const herbLines: string[] = []
    const prepLines: string[] = []
    const fangjieLines: string[] = []
    let phase: 'herbs' | 'prep' | 'fangjie' = 'herbs'

    // 「方用六味地黄汤∶熟地（二两）……水煎服。一剂……此方……」：药味、煎服、方解同在一行
    const prepStart = sameLineRest.search(INLINE_PREP_START_RE)
    const sameLineHerbPart = prepStart > 0 ? sameLineRest.slice(0, prepStart) : sameLineRest
    // 「方用六味地黄汤加味治之」中方名后的叙述不含剂量，不是药味行
    if (
      sameLineHerbPart &&
      looksLikeHerbLine(sameLineHerbPart) &&
      SAME_LINE_DOSE_RE.test(sameLineHerbPart)
    ) {
      herbLines.push(sameLineHerbPart)
      if (prepStart > 0) lines.splice(i, 0, sameLineRest.slice(prepStart))
    }

    // 本块若尚无方名，留给「此方名X」回填
    let pendingNameFromLater = ''

    while (i < lines.length) {
      const current = lines[i]!
      const nextHeaderAt = nextFormulaHeaderIndex(current)
      if (nextHeaderAt === 0) {
        // 「方用∶药列」后紧跟「此方名收黑虎汤」：就地取名并消费该行
        if (!detectedName && /^(?:此方名|方名)/.test(toSimplifiedChinese(current).trim())) {
          const named = extractFormulaName(current)
          if (named.name) {
            pendingNameFromLater = named.name
            const restFangjie = current
              .replace(/(?:此方名|方名)\s*[\u4e00-\u9fff]{2,16}(?:汤|湯|散|丸|膏|煎|饮|飲|丹)/, '')
              .replace(/^[，,。；]\s*/, '')
              .trim()
            if (restFangjie) fangjieLines.push(restFangjie)
            i += 1
          }
        }
        break
      }
      if (nextHeaderAt > 0) {
        // 行中后半另起一方：前半交回本轮药/煎服解析，后半留作下一张方头
        const before = current.slice(0, nextHeaderAt + 1).trim()
        const after = current.slice(nextHeaderAt + 1).trim()
        if (before && after) lines.splice(i, 1, before, after)
        else if (before) lines[i] = before
        else if (after) lines.splice(i, 1, after)
        continue
      }
      if (/(?:汤|湯|散|丸)\s*(?:亦可用|亦佳)/.test(current) && current.length < 40) break
      if (isAlternateIntroLine(current)) break
      // 无药味时也要停在下则起句，避免把下则正文吞作方解/假药味
      if (NEXT_CASE_RE.test(current)) break
      // 页码噪声
      if (/^\d+頁$|^\d+页$/.test(current)) {
        i += 1
        continue
      }

      if (phase === 'herbs') {
        // 「石膏（一两）知母（二钱）水煎服。一剂而……」：药味与煎服法同行，先切开
        const inlinePrepStart = current.search(INLINE_PREP_START_RE)
        const leadingHerbPart = inlinePrepStart > 0 ? current.slice(0, inlinePrepStart) : ''
        if (
          leadingHerbPart &&
          looksLikeHerbLine(leadingHerbPart) &&
          SAME_LINE_DOSE_RE.test(leadingHerbPart)
        ) {
          herbLines.push(leadingHerbPart)
          lines[i] = current.slice(inlinePrepStart)
          continue
        }
        // 「三味煎汤十碗，为主。倘生于头面，加川芎…」——煎服/加减说明，勿再当药味
        if (
          inlinePrepStart === 0 ||
          /^(?:三味煎|为主|倘生|未破|已破|不必二剂)/.test(current)
        ) {
          phase = 'prep'
          prepLines.push(current)
          i += 1
          continue
        }
        // 「二剂而愈」若与药味同行，不可整行当煎服法
        if (
          PREP_RE.test(current) ||
          (/剂轻|剂止|剂愈|剂而/.test(current) && !looksLikeHerbLine(current))
        ) {
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
    let fangjie = fangjieLines.join('')
    if (herbs.length === 0 && !fangjie && !preparation) continue

    let name = detectedName || pendingNameFromLater
    if (pendingNameFromLater) anonymous = false
    // 无名方药列后的方解里出现「此方名X」
    if (!name && fangjie) {
      const namedInFangjie = fangjie.match(
        new RegExp(`(?:此方名|方名)\\s*${FORMULA_NAME_RE.source}`),
      )
      if (namedInFangjie?.[1]) {
        name = normalizeChenfuFormulaName(namedInFangjie[1])
        fangjie = fangjie.replace(namedInFangjie[0], '').trim()
        anonymous = false
      }
    }
    if (!name) {
      const prefix = options?.anonymousPrefix ?? '无名方'
      name = `${prefix}·方${formulaIndex}`
    }
    if (isJunkChenfuFormulaName(name)) continue
    // 备选引语无药味（下则已起或仅点名）：不产出空方
    if (herbs.length === 0 && isAlternateIntro(introRaw)) continue
    // 「此方名X」仅点名无药：勿立空壳
    if (herbs.length === 0 && /(?:此方名|方名)/.test(introRaw) && !pendingNameFromLater) continue

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
      anonymous: Boolean(anonymous && !detectedName && !pendingNameFromLater),
      derivedFrom: extractDerivedFrom(fangjie),
      introRaw,
    })
  }

  return blocks
}
