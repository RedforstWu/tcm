/**
 * 《伤寒论》外部知识库（KB）交叉比对的纯函数：缺字通配、通配编辑距离与定位、方名异名归一、
 * 方名出现判定、药味/剂量比较、条文→方剂关联裁决、注家卡 id。
 * KB 只是候选标注，这里的裁决只给出“与原文是否相符”的结论，不把 KB 当真值。
 */
import type { EvidenceVerdict, VariantSegment } from './integration-contract.ts'
import {
  TEXT_AGREE_RATIO,
  TEXT_VARIANT_RATIO,
  classifyTextMatch,
  diffSegments,
  editDistance,
  locateInText,
  mapNormalizedRange,
  normalizeForCompare,
  type PreparedHaystack,
} from './text-normalize.ts'

// ---------------------------------------------------------------------------
// 缺字通配
// ---------------------------------------------------------------------------

/**
 * 缺字占位统一替换成的私用区字符：normalizeForCompare 保留私用区字符（\p{Co}），
 * 繁简转换不改动它，因此能原样进入比对串。调用方须先确认见证本中不含此字符。
 */
export const WILDCARD_CHAR = '\uE000'
const WILDCARD_CODE_POINT = 0xe000

/** 替换时用空格补足原长度，保证下标不变（空格在规范化时被剔除） */
const PADDING_CHAR = ' '

const GAIJI_ENTITY_RE = /&KR\d+;/g
/** 与 kanripo.ts 相同的组字式写法，如 `[病-丙+(穩-禾)]`，整体代表一个字 */
const IDS_COMPOSITION_RE = /\[[^[\]\n]*[-+][^[\]\n]*\][^\S\n]?/g
/** jobkoko 缺字占位：`KT` 后常跟一个空格（「项背强KT KT ，」） */
const KT_PLACEHOLDER_RE = /KT ?/g
/** 孤立空格之后的收尾标点 */
const CLOSING_PUNCTUATION = new Set(['，', '。', '；', '：', '∶', '、', '！', '？', '”', '’'])
/** 孤立空格之前的分句标点或左引号 */
const OPENING_PUNCTUATION = new Set(['，', '。', '；', '：', '∶', '、', '“', '‘'])
const HAN_RE = /^\p{Script=Han}$/u

export interface MissingCharStats {
  /** Kanripo `&KR0238;` 缺字实体 */
  gaijiEntity: number
  /** Kanripo 组字式 */
  idsComposition: number
  /** jobkoko `KT` 占位 */
  ktPlaceholder: number
  /** jobkoko 夹在汉字与标点之间的单个空格（缺字被吞后留下的空位） */
  isolatedSpace: number
}

export interface MaskedText {
  text: string
  stats: MissingCharStats
}

export function emptyMissingCharStats(): MissingCharStats {
  return { gaijiEntity: 0, idsComposition: 0, ktPlaceholder: 0, isolatedSpace: 0 }
}

export function addMissingCharStats(target: MissingCharStats, source: MissingCharStats): void {
  target.gaijiEntity += source.gaijiEntity
  target.idsComposition += source.idsComposition
  target.ktPlaceholder += source.ktPlaceholder
  target.isolatedSpace += source.isolatedSpace
}

function paddedWildcard(length: number): string {
  if (!Number.isInteger(length) || length < 1) throw new RangeError(`paddedWildcard：长度须为正整数，实际为 ${length}`)
  return WILDCARD_CHAR + PADDING_CHAR.repeat(length - 1)
}

function assertNoWildcard(text: string, label: string): void {
  if (text.includes(WILDCARD_CHAR)) {
    throw new Error(`${label} 已含通配占位字符 U+E000，无法区分缺字与原文`)
  }
}

/** Kanripo 文本：缺字实体与组字式 → 通配字符（等长替换，下标不变） */
export function maskKanripoMissingChars(text: string): MaskedText {
  assertNoWildcard(text, 'Kanripo 文本')
  const stats = emptyMissingCharStats()
  const masked = text
    .replace(GAIJI_ENTITY_RE, (entity) => {
      stats.gaijiEntity += 1
      return paddedWildcard(entity.length)
    })
    .replace(IDS_COMPOSITION_RE, (composition) => {
      stats.idsComposition += 1
      return paddedWildcard(composition.length)
    })
  return { text: masked, stats }
}

function isIsolatedMissingSpace(previous: string | undefined, next: string | undefined): boolean {
  if (previous === undefined || next === undefined) return false
  if (/\s/.test(previous) || /\s/.test(next)) return false
  const previousIsHan = HAN_RE.test(previous)
  const nextIsHan = HAN_RE.test(next)
  if ((previousIsHan || previous === '“' || previous === '‘') && CLOSING_PUNCTUATION.has(next)) return true
  return OPENING_PUNCTUATION.has(previous) && (nextIsHan || next === '”' || next === '’')
}

/**
 * jobkoko 文本：先把「汉字/左引号 + 单空格 + 收尾标点」与「分句标点 + 单空格 + 汉字/右引号」中的空格换成通配，
 * 再把 `KT` 占位（含其后空格）换成通配。汉字之间的空格多为药味分隔，不视为缺字；行尾空格同理。
 */
export function maskJobkokoMissingChars(text: string): MaskedText {
  assertNoWildcard(text, 'jobkoko 文本')
  const stats = emptyMissingCharStats()
  const chars = text.split('')
  for (let index = 1; index < chars.length - 1; index += 1) {
    if (chars[index] !== ' ') continue
    if (!isIsolatedMissingSpace(chars[index - 1], chars[index + 1])) continue
    chars[index] = WILDCARD_CHAR
    stats.isolatedSpace += 1
  }
  const spaced = chars.join('')
  const masked = spaced.replace(KT_PLACEHOLDER_RE, (placeholder) => {
    stats.ktPlaceholder += 1
    return paddedWildcard(placeholder.length)
  })
  return { text: masked, stats }
}

// ---------------------------------------------------------------------------
// 通配编辑距离与定位
// ---------------------------------------------------------------------------

function codePointsOf(text: string): Int32Array {
  return Int32Array.from(Array.from(text, (char) => char.codePointAt(0)!))
}

/** 通配可匹配任一字（代价 0），也可被整体跳过（代价 0，用于吸收占位噪声空格） */
function substitutionCost(left: number, right: number): number {
  return left === right || left === WILDCARD_CODE_POINT || right === WILDCARD_CODE_POINT ? 0 : 1
}

function gapCost(codePoint: number): number {
  return codePoint === WILDCARD_CODE_POINT ? 0 : 1
}

/** 按码点的 Levenshtein 距离；通配字符与任意字相配或被跳过均不计代价 */
export function wildcardEditDistance(left: string, right: string): number {
  const first = codePointsOf(left)
  const second = codePointsOf(right)
  let previous = new Int32Array(second.length + 1)
  let current = new Int32Array(second.length + 1)
  for (let column = 1; column <= second.length; column += 1) {
    previous[column] = previous[column - 1]! + gapCost(second[column - 1]!)
  }
  for (let row = 1; row <= first.length; row += 1) {
    const rowChar = first[row - 1]!
    current[0] = previous[0]! + gapCost(rowChar)
    for (let column = 1; column <= second.length; column += 1) {
      const columnChar = second[column - 1]!
      current[column] = Math.min(
        previous[column - 1]! + substitutionCost(rowChar, columnChar),
        previous[column]! + gapCost(rowChar),
        current[column - 1]! + gapCost(columnChar),
      )
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[second.length]!
}

/** 1 - 通配编辑距离 / max(码点长度)；两串均为空时为 1 */
export function wildcardSimilarity(left: string, right: string): number {
  const longest = Math.max(Array.from(left).length, Array.from(right).length)
  if (longest === 0) return 1
  return 1 - wildcardEditDistance(left, right) / longest
}

export interface WildcardAlignment {
  cost: number
  /** 窗口串内码点下标 */
  start: number
  end: number
}

/** 半全局对齐（引文须完整参与，窗口两端自由截取），通配规则同 wildcardEditDistance */
export function wildcardSemiGlobalAlign(needle: string, window: string): WildcardAlignment {
  const needlePoints = codePointsOf(needle)
  const windowPoints = codePointsOf(window)
  const needleLength = needlePoints.length
  let previousCost = new Int32Array(needleLength + 1)
  let currentCost = new Int32Array(needleLength + 1)
  let previousStart = new Int32Array(needleLength + 1)
  let currentStart = new Int32Array(needleLength + 1)
  for (let row = 1; row <= needleLength; row += 1) {
    previousCost[row] = previousCost[row - 1]! + gapCost(needlePoints[row - 1]!)
  }
  let best: WildcardAlignment = { cost: previousCost[needleLength]!, start: 0, end: 0 }
  for (let column = 1; column <= windowPoints.length; column += 1) {
    const windowChar = windowPoints[column - 1]!
    currentCost[0] = 0
    currentStart[0] = column
    for (let row = 1; row <= needleLength; row += 1) {
      const needleChar = needlePoints[row - 1]!
      let cost = previousCost[row - 1]! + substitutionCost(needleChar, windowChar)
      let start = previousStart[row - 1]!
      const skipWindowChar = previousCost[row]! + gapCost(windowChar)
      if (skipWindowChar < cost) {
        cost = skipWindowChar
        start = previousStart[row]!
      }
      const skipNeedleChar = currentCost[row - 1]! + gapCost(needleChar)
      if (skipNeedleChar < cost) {
        cost = skipNeedleChar
        start = currentStart[row - 1]!
      }
      currentCost[row] = cost
      currentStart[row] = start
    }
    const endCost = currentCost[needleLength]!
    const endStart = currentStart[needleLength]!
    if (
      endCost < best.cost ||
      (endCost === best.cost &&
        Math.abs(column - endStart - needleLength) < Math.abs(best.end - best.start - needleLength))
    ) {
      best = { cost: endCost, start: endStart, end: column }
    }
    ;[previousCost, currentCost] = [currentCost, previousCost]
    ;[previousStart, currentStart] = [currentStart, previousStart]
  }
  return best
}

/** 短于此规范字数的引文只做精确（含通配）定位 */
export const MIN_FUZZY_LOCATE_LENGTH = 8
/** 模糊定位的最低候选相似度：低于 TEXT_VARIANT_RATIO 的命中仍报出位置（记 mismatch），供人工复核 */
export const LOCATE_MIN_RATIO = 0.6
/** 精修窗口两侧冗余：至少此字数 */
const REFINE_MIN_SLACK = 8
/** 精修窗口两侧冗余占引文长度的比例 */
const REFINE_SLACK_RATIO = 0.25

export interface WildcardLocateResult {
  /** 原文（遮蔽后等长文本）起止下标 */
  start: number
  end: number
  ratio: number
  /** 规范串完全相同（通配视为相同） */
  exact: boolean
  /** 命中区间内包含通配字符 */
  usedWildcard: boolean
}

function lowerBound(values: Int32Array, target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (values[mid]! < target) low = mid + 1
    else high = mid
  }
  return low
}

/** 把码点下标换算为 UTF-16 下标 */
function codePointOffsetToUnit(text: string, codePointOffset: number): number {
  let unit = 0
  let points = 0
  while (points < codePointOffset && unit < text.length) {
    unit += text.codePointAt(unit)! > 0xffff ? 2 : 1
    points += 1
  }
  return unit
}

function alignInNormalizedRange(
  needle: string,
  prepared: PreparedHaystack,
  rangeStart: number,
  rangeEnd: number,
): { start: number; end: number; ratio: number; cost: number } | null {
  const haystack = prepared.normalized.text
  const windowText = haystack.slice(rangeStart, rangeEnd)
  if (!windowText) return null
  const hit = wildcardSemiGlobalAlign(needle, windowText)
  if (hit.end <= hit.start) return null
  const start = rangeStart + codePointOffsetToUnit(windowText, hit.start)
  const end = rangeStart + codePointOffsetToUnit(windowText, hit.end)
  const ratio = wildcardSimilarity(needle, haystack.slice(start, end))
  return { start, end, ratio, cost: hit.cost }
}

function toLocateResult(
  prepared: PreparedHaystack,
  normalizedStart: number,
  normalizedEnd: number,
  ratio: number,
  exact: boolean,
): WildcardLocateResult {
  const range = mapNormalizedRange(prepared.normalized, normalizedStart, normalizedEnd)
  return {
    start: range.start,
    end: range.end,
    ratio,
    exact,
    usedWildcard: prepared.normalized.text.slice(normalizedStart, normalizedEnd).includes(WILDCARD_CHAR),
  }
}

/**
 * 含缺字通配的定位：
 * 1. 规范串精确查找；
 * 2. 短引文（< MIN_FUZZY_LOCATE_LENGTH）在全文做通配半全局对齐，只接受代价 0；
 * 3. 长引文先用 locateInText 找候选窗口（通配在那里按普通字计），再在窗口内用通配对齐精修比率。
 * prepared 须由遮蔽后的文本生成。
 */
export function locateWithWildcards(
  needle: string,
  prepared: PreparedHaystack,
  minRatio = LOCATE_MIN_RATIO,
): WildcardLocateResult | null {
  const normalizedNeedle = normalizeForCompare(needle, prepared.options)
  const haystack = prepared.normalized.text
  if (!normalizedNeedle || !haystack) return null
  const exactIndex = haystack.indexOf(normalizedNeedle)
  if (exactIndex >= 0) {
    return toLocateResult(prepared, exactIndex, exactIndex + normalizedNeedle.length, 1, true)
  }
  const needleLength = Array.from(normalizedNeedle).length
  if (needleLength < MIN_FUZZY_LOCATE_LENGTH) {
    if (!haystack.includes(WILDCARD_CHAR)) return null
    const hit = alignInNormalizedRange(normalizedNeedle, prepared, 0, haystack.length)
    if (!hit || hit.cost > 0) return null
    return toLocateResult(prepared, hit.start, hit.end, 1, true)
  }
  const candidate = locateInText(needle, prepared, { minRatio })
  if (!candidate) return null
  const { offsetMap } = prepared.normalized
  const candidateStart = lowerBound(offsetMap, candidate.start)
  const candidateEnd = Math.max(candidateStart + 1, lowerBound(offsetMap, candidate.end))
  const slack = Math.max(REFINE_MIN_SLACK, Math.ceil(normalizedNeedle.length * REFINE_SLACK_RATIO))
  const refined = alignInNormalizedRange(
    normalizedNeedle,
    prepared,
    Math.max(0, candidateStart - slack),
    Math.min(haystack.length, candidateEnd + slack),
  )
  if (!refined || refined.ratio < candidate.ratio) {
    return { start: candidate.start, end: candidate.end, ratio: candidate.ratio, exact: false, usedWildcard: false }
  }
  if (refined.ratio + 1e-9 < minRatio) return null
  return toLocateResult(prepared, refined.start, refined.end, refined.ratio, refined.cost === 0)
}

// ---------------------------------------------------------------------------
// 裁决与异文
// ---------------------------------------------------------------------------

/** 文本相似度 → verdict（与 classifyTextMatch 同阈值） */
export function textVerdict(ratio: number): Exclude<EvidenceVerdict, 'missing'> {
  return classifyTextMatch(ratio)
}

/** 四舍五入到 4 位小数，保证输出稳定 */
export function roundRatio(ratio: number): number {
  return Math.round(ratio * 10_000) / 10_000
}

/** text-normalize 的 diffSegments（a=本地，b=见证）→ 契约 VariantSegment */
export function toVariantSegments(local: string, witness: string): VariantSegment[] {
  return diffSegments(local, witness).map((segment) => ({ op: segment.op, local: segment.a, witness: segment.b }))
}

export { TEXT_AGREE_RATIO, TEXT_VARIANT_RATIO }

// ---------------------------------------------------------------------------
// 方名异名
// ---------------------------------------------------------------------------

export type FormulaAliasKind = 'KB异名' | '原文异写' | '原文错字' | '简称' | '同方异名待核'

export interface FormulaAliasEntry {
  names: string[]
  kind: FormulaAliasKind
  /** 依据：原文出处或 KB 异名字段 */
  evidence: string
}

/** 只收能在原文（维基宋本 / jobkoko 宋版 / 注解伤寒论）中找到依据的异名；KB 异名字段另行导入 */
export const MANUAL_FORMULA_ALIASES: readonly FormulaAliasEntry[] = [
  {
    names: ['枳实栀子豉汤', '枳实栀子汤'],
    kind: '原文异写',
    evidence: '宋版（jobkoko S-003）第 393 条作「枳实栀子汤主之」；维基宋本与《注解伤寒论》方题作「枳实栀子豉汤方」',
  },
  {
    names: ['通脉四逆加猪胆汁汤', '通脉四逆加猪胆汤'],
    kind: '原文异写',
    evidence: '宋版（jobkoko S-003）第 390 条作「通脉四逆加猪胆汤主之」；《注解伤寒论》校注「赵本无汁字」',
  },
  {
    names: ['栀子柏皮汤', '栀子檗皮汤'],
    kind: '原文异写',
    evidence: '维基宋本第 261 条作「栀子柏皮汤主之」，其后方题作「栀子檗皮汤方」',
  },
  {
    names: ['白散', '三物白散', '三物小白散'],
    kind: '原文异写',
    evidence: '维基宋本第 141 条「白散亦可服」，方题作「三物小白散方」；KB「白散」异名字段为「三物白散」',
  },
  {
    names: ['蜜煎', '蜜煎导'],
    kind: '原文异写',
    evidence: '宋本第 233 条「宜蜜煎导而通之」；维基宋本方题「蜜煎导方」，宋版（S-003）方题「蜜煎方」',
  },
  {
    names: ['桂枝甘草汤', '桂技甘草汤'],
    kind: '原文错字',
    evidence: '维基宋本第 64 条作「桂枝甘草汤主之」，其后方题误作「桂技甘草汤方」',
  },
  {
    names: ['桂枝加芍药生姜各一两人参三两新加汤', '桂枝加芍药生姜人参新加汤', '新加汤'],
    kind: '简称',
    evidence: '宋本第 62 条「桂枝加芍药生姜各一两人参三两新加汤主之」；可发汗篇方题「桂枝加芍药生姜人参新加汤方」；KB 卡名「新加汤」',
  },
]

export interface RejectedKbAlias {
  formula: string
  alias: string
  reason: string
}

/** 经核不予采纳的 KB 异名 */
export const REJECTED_KB_ALIASES: readonly RejectedKbAlias[] = [
  {
    formula: '桂枝去桂加茯苓白术汤',
    alias: '去桂枝加白术汤',
    reason: 'KB 另有「去桂枝加白术汤」卡（附子、白术、生姜、甘草、大枣，即第 174 条去桂加白术汤），与第 28 条方不同',
  },
  {
    formula: '四逆加吴茱萸生姜汤',
    alias: '宜当归四逆加吴茱萸生姜汤',
    reason: '含「宜」字，是条文片段而非方名',
  },
]

export interface KbAliasSource {
  name: string
  aliases: readonly string[]
}

/** 方名 → 比对键：繁简、异体归一后去标点 */
export function formulaNameKey(name: string): string {
  return normalizeForCompare(name)
}

/** 并查集式的方名归一：同组方名得到同一 canonical 键 */
export class FormulaNameResolver {
  private readonly parent = new Map<string, string>()
  /** 比对键 → 首次登记的原始写法，用于报告 */
  private readonly display = new Map<string, string>()
  readonly acceptedAliases: Array<FormulaAliasEntry> = []
  readonly rejectedAliases: RejectedKbAlias[] = []

  private find(key: string): string {
    let root = key
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!
    let cursor = key
    while (cursor !== root) {
      const next = this.parent.get(cursor)!
      this.parent.set(cursor, root)
      cursor = next
    }
    return root
  }

  register(name: string): string {
    const key = formulaNameKey(name)
    if (!key) throw new Error(`方名「${name}」规范化后为空`)
    if (!this.parent.has(key)) {
      this.parent.set(key, key)
      this.display.set(key, name)
    }
    return key
  }

  private union(left: string, right: string): void {
    const leftRoot = this.find(this.register(left))
    const rightRoot = this.find(this.register(right))
    if (leftRoot === rightRoot) return
    // 以码点序较小者为根，保证与登记顺序无关
    if (leftRoot < rightRoot) this.parent.set(rightRoot, leftRoot)
    else this.parent.set(leftRoot, rightRoot)
  }

  addGroup(entry: FormulaAliasEntry): void {
    if (entry.names.length < 2) throw new Error(`异名组至少需要 2 个方名：${entry.names.join('、')}`)
    for (const name of entry.names.slice(1)) this.union(entry.names[0]!, name)
    this.acceptedAliases.push(entry)
  }

  /** 导入 KB 异名字段，跳过 REJECTED_KB_ALIASES */
  addKbAliases(formulas: readonly KbAliasSource[], rejected: readonly RejectedKbAlias[] = REJECTED_KB_ALIASES): void {
    for (const formula of formulas) {
      this.register(formula.name)
      for (const alias of formula.aliases) {
        const rejection = rejected.find((item) => item.formula === formula.name && item.alias === alias)
        if (rejection) {
          this.rejectedAliases.push(rejection)
          continue
        }
        this.addGroup({ names: [formula.name, alias], kind: 'KB异名', evidence: `KB 方剂卡「${formula.name}」异名字段` })
      }
    }
  }

  canonical(name: string): string {
    return this.find(this.register(name))
  }

  same(left: string, right: string): boolean {
    return this.canonical(left) === this.canonical(right)
  }

  /** 已登记的全部方名比对键（含异名） */
  allKeys(): string[] {
    return [...this.parent.keys()]
  }

  displayName(key: string): string {
    return this.display.get(key) ?? key
  }
}

export function createFormulaNameResolver(
  kbFormulas: readonly KbAliasSource[],
  extraNames: readonly string[] = [],
  manual: readonly FormulaAliasEntry[] = MANUAL_FORMULA_ALIASES,
): FormulaNameResolver {
  const resolver = new FormulaNameResolver()
  resolver.addKbAliases(kbFormulas)
  for (const entry of manual) resolver.addGroup(entry)
  for (const name of extraNames) resolver.register(name)
  return resolver
}

// ---------------------------------------------------------------------------
// 方名出现判定
// ---------------------------------------------------------------------------

export interface FormulaMention {
  /** 规范化后的方名键 */
  key: string
  canonical: string
  /** 在规范串中的位置 */
  start: number
  end: number
  /** 前文为「不可与 / 勿 / 非 …」等禁用或否定语境 */
  negated: boolean
  /** 处方语境：「宜X」「与X」「X主之」「X发之」等；「服X后…」之类叙述不算 */
  prescriptive: boolean
}

/** 方名之前的禁用/否定语境（作用于规范串，标点已去） */
const NEGATION_BEFORE_RE = /(不可|不得|勿|禁|不中|不须|非)(更)?(与|服|用|行|作)?$/
const NEGATION_LOOKBEHIND = 5
/** 方名之前的处方用语 */
const PRESCRIPTIVE_BEFORE_RE = /(宜|与|作|当服|宜服|以)$/
/** 方名之后的处方用语 */
const PRESCRIPTIVE_AFTER_RE = /^(主之|亦主之|发之|和之|亦可服|攻之|下之)/
const PRESCRIPTIVE_LOOKAROUND = 4

/**
 * 在文本中找全部方名出现：按方名键长度降序、不重叠（长名优先，避免「通脉四逆汤」误算「四逆汤」）。
 * text 为原文（函数内部规范化），返回位置基于规范串。
 */
export function findFormulaMentions(text: string, resolver: FormulaNameResolver): FormulaMention[] {
  const normalized = normalizeForCompare(text)
  if (!normalized) return []
  const keys = resolver.allKeys().sort((left, right) => right.length - left.length || (left < right ? -1 : 1))
  const covered = new Uint8Array(normalized.length)
  const mentions: FormulaMention[] = []
  for (const key of keys) {
    let from = 0
    while (from <= normalized.length - key.length) {
      const offset = normalized.indexOf(key, from)
      if (offset < 0) break
      const end = offset + key.length
      let overlap = false
      for (let index = offset; index < end; index += 1) {
        if (covered[index]) {
          overlap = true
          break
        }
      }
      if (!overlap) {
        covered.fill(1, offset, end)
        const before = normalized.slice(Math.max(0, offset - NEGATION_LOOKBEHIND), offset)
        const negated = NEGATION_BEFORE_RE.test(before)
        const prescriptive =
          !negated &&
          (PRESCRIPTIVE_BEFORE_RE.test(normalized.slice(Math.max(0, offset - PRESCRIPTIVE_LOOKAROUND), offset)) ||
            PRESCRIPTIVE_AFTER_RE.test(normalized.slice(end, end + PRESCRIPTIVE_LOOKAROUND)))
        mentions.push({ key, canonical: resolver.canonical(key), start: offset, end, negated, prescriptive })
      }
      from = offset + 1
    }
  }
  return mentions.sort((left, right) => left.start - right.start)
}

/** 方题行：「桂枝汤方」「猪胆汁方（附方）」「枳实栀子豉汤方∶」 */
const FORMULA_HEADING_RE = /^([\u4e00-\u9fff]{2,24}?)方(?:[（(][^）)]*[）)])?[：:∶]?$/

/** 方题行 → 方名；非方题返回 null（输入应为已繁简转换、去首尾空白的单行） */
export function formulaHeadingName(line: string): string | null {
  return FORMULA_HEADING_RE.exec(line.trim())?.[1] ?? null
}

/**
 * prescribed：条文本文以处方语境出现；heading：紧随方剂区段的方题；
 * mentioned：条文本文提及但非处方语境（如「服桂枝汤，大汗出后」）；sectionBody：仅见于方后注；
 * negated：仅见于禁用/否定语境；none：均未见
 */
export type MentionStrength = 'prescribed' | 'heading' | 'mentioned' | 'sectionBody' | 'negated' | 'none'

export interface ClauseFormulaContext {
  /** 条文本文 */
  text: string
  /** 紧随条文的方剂区段中的方题（方名） */
  sectionHeadings: readonly string[]
  /** 方剂区段正文（组成、煎服法、方后注） */
  sectionBody: string
}

/** 某方（canonical）在条文/方剂区段中的最强出现方式 */
export function mentionStrength(
  canonical: string,
  context: ClauseFormulaContext,
  resolver: FormulaNameResolver,
): MentionStrength {
  const textMentions = findFormulaMentions(context.text, resolver).filter((mention) => mention.canonical === canonical)
  if (textMentions.some((mention) => mention.prescriptive)) return 'prescribed'
  if (context.sectionHeadings.some((heading) => resolver.canonical(heading) === canonical)) return 'heading'
  if (textMentions.some((mention) => !mention.negated)) return 'mentioned'
  const bodyMentions = findFormulaMentions(context.sectionBody, resolver).filter(
    (mention) => mention.canonical === canonical,
  )
  if (bodyMentions.some((mention) => !mention.negated)) return 'sectionBody'
  if (textMentions.length > 0 || bodyMentions.length > 0) return 'negated'
  return 'none'
}

export type FormulaLinkConclusion = '双方一致' | '双方一致但需人工' | '本地漏' | 'KB 多' | 'KB 漏' | '需人工'

export interface FormulaLinkJudgement {
  verdict: Extract<EvidenceVerdict, 'agree' | 'mismatch'>
  conclusion: FormulaLinkConclusion
  reason: string
}

const STRENGTH_LABEL: Record<MentionStrength, string> = {
  prescribed: '条文本文以处方语境出现方名',
  heading: '紧随方剂区段方题为此方',
  mentioned: '条文本文提及方名但非处方语境',
  sectionBody: '仅见于方剂区段的方后注',
  negated: '原文中仅见于禁用/否定语境',
  none: '条文及其方剂区段均未见方名',
}

/**
 * 条文→方剂关联裁决：方名以处方语境出现在条文本文、或为紧随方剂区段的方题，关联才成立；
 * 仅叙述性提及、仅见于方后注或否定语境的，交人工判定。
 */
export function judgeFormulaLink(inKb: boolean, inLocal: boolean, strength: MentionStrength): FormulaLinkJudgement {
  if (!inKb && !inLocal) throw new Error('judgeFormulaLink：KB 与本地至少一方须有关联')
  const established = strength === 'prescribed' || strength === 'heading'
  const reason = STRENGTH_LABEL[strength]
  if (inKb && inLocal) {
    return established || strength === 'mentioned'
      ? { verdict: 'agree', conclusion: '双方一致', reason }
      : { verdict: 'agree', conclusion: '双方一致但需人工', reason }
  }
  if (inKb) {
    if (established) return { verdict: 'mismatch', conclusion: '本地漏', reason }
    if (strength === 'none') return { verdict: 'mismatch', conclusion: 'KB 多', reason }
    return { verdict: 'mismatch', conclusion: '需人工', reason }
  }
  if (established) return { verdict: 'mismatch', conclusion: 'KB 漏', reason }
  return { verdict: 'mismatch', conclusion: '需人工', reason: `本地有关联，但${reason}` }
}

// ---------------------------------------------------------------------------
// 方剂比较
// ---------------------------------------------------------------------------

export interface HerbSetInput {
  /** 本地药味（已规范化） */
  local: readonly string[]
  /** KB 药味（已规范化，不含以方为药成分） */
  kb: readonly string[]
  /** KB 以方为药的成分，如「桂枝汤二升」 */
  formulaComponents: readonly string[]
  /** 以方为药成分展开后的药味（已规范化），用于判断本地多出的药是否来自该成分 */
  componentHerbs: readonly string[]
  /** KB 标为「食材/辅料」的药味（已规范化） */
  kbAuxiliary?: readonly string[]
}

export interface HerbNamePair {
  local: string
  kb: string
}

export interface HerbSetComparison {
  verdict: Exclude<EvidenceVerdict, 'missing'>
  /** Jaccard 系数（疑同药不计入交集） */
  ratio: number
  shared: string[]
  localOnly: string[]
  kbOnly: string[]
  /** 写法相近、疑为同一药物的配对（药名词表未收录其一） */
  nearPairs: HerbNamePair[]
  note: string
}

const zhCollator = new Intl.Collator('zh-Hans-CN')

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => zhCollator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0))
}

const MIN_NEAR_HERB_NAME_LENGTH = 2

/** 疑同药：一方包含另一方（≥ 2 字，如 茵陈蒿/茵陈、代赭/代赭石），或等长且只差一字（如 石苇/石韦） */
export function isNearHerbName(left: string, right: string): boolean {
  const leftLength = Array.from(left).length
  const rightLength = Array.from(right).length
  if (Math.min(leftLength, rightLength) < MIN_NEAR_HERB_NAME_LENGTH) return false
  if (left.includes(right) || right.includes(left)) return true
  return leftLength === rightLength && editDistance(left, right) === 1
}

function pairNearHerbNames(localOnly: string[], kbOnly: string[]): HerbNamePair[] {
  const pairs: HerbNamePair[] = []
  const usedKb = new Set<string>()
  for (const local of localOnly) {
    const kb = kbOnly.find((candidate) => !usedKb.has(candidate) && isNearHerbName(local, candidate))
    if (kb === undefined) continue
    usedKb.add(kb)
    pairs.push({ local, kb })
  }
  return pairs
}

/**
 * 药味集合比较：集合相同为 agree。以下差异记 variant：
 * - 疑同药（写法相近，见 isNearHerbName）；
 * - KB 多出的仅是标为「食材/辅料」的药味（本地常把蜜、粳米等写在煎服法里）；
 * - KB 含以方为药成分时，成分本身不比较，本地多出的药味均可由成分展开得到。
 * 其余为 mismatch。
 */
export function compareHerbSets(input: HerbSetInput): HerbSetComparison {
  const localSet = new Set(input.local)
  const kbSet = new Set(input.kb)
  const shared = sortedUnique([...localSet].filter((herb) => kbSet.has(herb)))
  const localOnly = sortedUnique([...localSet].filter((herb) => !kbSet.has(herb)))
  const kbOnly = sortedUnique([...kbSet].filter((herb) => !localSet.has(herb)))
  const unionSize = new Set([...localSet, ...kbSet]).size
  const ratio = unionSize === 0 ? 1 : shared.length / unionSize
  const nearPairs = pairNearHerbNames(localOnly, kbOnly)
  const pairedLocal = new Set(nearPairs.map((pair) => pair.local))
  const pairedKb = new Set(nearPairs.map((pair) => pair.kb))
  const auxiliary = new Set(input.kbAuxiliary ?? [])
  const expandable = new Set(input.componentHerbs)
  const unexplainedLocal = localOnly.filter(
    (herb) => !pairedLocal.has(herb) && !(input.formulaComponents.length > 0 && expandable.has(herb)),
  )
  const kbAuxiliaryOnly = kbOnly.filter((herb) => !pairedKb.has(herb) && auxiliary.has(herb))
  const unexplainedKb = kbOnly.filter((herb) => !pairedKb.has(herb) && !auxiliary.has(herb))

  const parts: string[] = []
  if (localOnly.length > 0) parts.push(`本地多：${localOnly.join('、')}`)
  if (kbOnly.length > 0) parts.push(`KB 多：${kbOnly.join('、')}`)
  if (nearPairs.length > 0) parts.push(`疑同药（写法差异）：${nearPairs.map((pair) => `${pair.local}≈${pair.kb}`).join('、')}`)
  if (kbAuxiliaryOnly.length > 0) parts.push(`KB 多出的为食材/辅料：${kbAuxiliaryOnly.join('、')}`)
  if (input.formulaComponents.length > 0) {
    parts.push(`KB 以方为药（未作药味比较）：${input.formulaComponents.join('、')}`)
  }
  const result = { ratio, shared, localOnly, kbOnly, nearPairs }
  if (localOnly.length === 0 && kbOnly.length === 0) {
    return { verdict: 'agree', ...result, note: parts.join('；') || '药味一致' }
  }
  if (unexplainedLocal.length === 0 && unexplainedKb.length === 0) {
    if (input.formulaComponents.length > 0 && localOnly.some((herb) => expandable.has(herb))) {
      parts.push('本地多出的药味可由以方为药成分展开得到')
    }
    return { verdict: 'variant', ...result, note: parts.join('；') }
  }
  return { verdict: 'mismatch', ...result, note: parts.join('；') }
}

/** 数量起始字（药名在此之前结束） */
const DOSE_START_CHARS = new Set(Array.from('一二三四五六七八九十百千半廿各等'))
/** 剂量中的「数字+单位」：如「三两」「十二枚」「半升」「一两半」「一两二铢」「一鸡子大」 */
const DOSE_QUANTITY_RE =
  /[一二三四五六七八九十百千半廿两]+(?:两|分|铢|升|合|斤|枚|个|茎|片|尺|寸|把|握|钱|斗|鸡子大|方寸匕)(?:[一二三四五六七八九十半]+(?:铢|分|合)|半)?|等分/

/**
 * 本地「药名+剂量+修治」原文 → 剂量部分：先取能解析为同一规范药名的最短前缀，
 * 再在不越过数量起始字的前提下向后扩展（「芎穷一两」去掉「芎穷」，「蜀椒一两」去掉「蜀椒」）。
 * 找不到药名前缀时返回整串规范文本；只有药名时返回空串。
 */
export function extractDoseText(
  raw: string,
  canonicalHerb: string,
  resolve: (name: string) => string | null,
): string {
  const normalized = normalizeForCompare(raw)
  const points = Array.from(normalized)
  const matchesHerb = (length: number) => {
    const prefix = points.slice(0, length).join('')
    return prefix === canonicalHerb || resolve(prefix) === canonicalHerb
  }
  let prefixLength = 0
  for (let length = 1; length <= points.length; length += 1) {
    if (matchesHerb(length)) {
      prefixLength = length
      break
    }
  }
  if (prefixLength === 0) return normalized
  while (prefixLength < points.length && !DOSE_START_CHARS.has(points[prefixLength]!) && matchesHerb(prefixLength + 1)) {
    prefixLength += 1
  }
  return points.slice(prefixLength).join('')
}

/** 计数单位的等价写法（宋本「栀子十四个」，他本多作「十四枚」） */
const DOSE_UNIT_EQUIVALENTS: Readonly<Record<string, string>> = { 个: '枚' }

/**
 * 剂量中的数量部分（忽略「大者」「炮去皮」等修饰）；找不到数量词时返回整串。
 * 「两半」补作「一两半」，等价计数单位统一，便于判断「数量相同」。
 */
export function doseQuantity(doseText: string): string {
  const normalized = normalizeForCompare(doseText)
    .replace(/^各/, '')
    .replace(/^两半/, '一两半')
  const quantity = DOSE_QUANTITY_RE.exec(normalized)?.[0] ?? normalized
  return quantity.replace(/[个]/g, (unit) => DOSE_UNIT_EQUIVALENTS[unit] ?? unit)
}

export interface DosePair {
  herb: string
  local: string | null
  kb: string | null
}

export interface DoseComparison {
  verdict: Exclude<EvidenceVerdict, 'missing'>
  /** 剂量完全一致的药味占比 */
  ratio: number
  compared: number
  differences: Array<{ herb: string; local: string; kb: string; level: 'variant' | 'mismatch' }>
}

/** 逐味比较剂量：规范串相同 agree；数量相同仅修治/注语不同 variant；数量不同 mismatch */
export function compareDoses(pairs: readonly DosePair[]): DoseComparison | null {
  let agree = 0
  let compared = 0
  const differences: DoseComparison['differences'] = []
  for (const pair of pairs) {
    if (pair.local === null || pair.kb === null) continue
    const local = normalizeForCompare(pair.local).replace(/^各/, '')
    const kb = normalizeForCompare(pair.kb).replace(/^各/, '')
    if (!local || !kb) continue
    compared += 1
    if (local === kb) {
      agree += 1
      continue
    }
    const level = doseQuantity(local) === doseQuantity(kb) ? 'variant' : 'mismatch'
    differences.push({ herb: pair.herb, local: pair.local, kb: pair.kb, level })
  }
  if (compared === 0) return null
  const verdict = differences.some((item) => item.level === 'mismatch')
    ? 'mismatch'
    : differences.length > 0
      ? 'variant'
      : 'agree'
  return { verdict, ratio: agree / compared, compared, differences }
}

/** 方名编辑距离 ≤ 1 的模糊候选（用于发现错字/漏字，须再以药味相同确认） */
export function isNearFormulaName(left: string, right: string): boolean {
  const leftKey = formulaNameKey(left)
  const rightKey = formulaNameKey(right)
  if (leftKey === rightKey) return true
  if (Math.abs(leftKey.length - rightKey.length) > 1) return false
  return editDistance(leftKey, rightKey) <= 1
}

// ---------------------------------------------------------------------------
// 注家卡 id
// ---------------------------------------------------------------------------

export const SONGBEN_CLAUSE_MIN = 1
export const SONGBEN_CLAUSE_MAX = 398
const CLAUSE_NUMBER_WIDTH = 3

export function songbenClauseId(clauseNumber: number): string {
  if (!Number.isInteger(clauseNumber) || clauseNumber < SONGBEN_CLAUSE_MIN || clauseNumber > SONGBEN_CLAUSE_MAX) {
    throw new RangeError(`宋本条文号须为 ${SONGBEN_CLAUSE_MIN}..${SONGBEN_CLAUSE_MAX} 的整数，实际为 ${clauseNumber}`)
  }
  return `songben-${clauseNumber}`
}

/** `commentary-<注家>-<条文号三位>`，如 `commentary-尤怡-012` */
export function commentaryId(commentator: string, clauseNumber: number): string {
  const name = commentator.trim()
  if (!name) throw new Error('commentaryId：注家名为空')
  if (/[\s/\\#]/.test(name)) throw new Error(`commentaryId：注家名含非法字符「${commentator}」`)
  songbenClauseId(clauseNumber)
  return `commentary-${name}-${String(clauseNumber).padStart(CLAUSE_NUMBER_WIDTH, '0')}`
}

/** 引文核验：归一化后精确或通配相似度 ≥ TEXT_AGREE_RATIO */
export function isQuoteVerified(ratio: number | null): boolean {
  return ratio !== null && classifyTextMatch(ratio) === 'agree'
}

const QUOTE_ELLIPSIS_RE = /…+|\.{3,}|。{3,}/

/**
 * KB 引文 → 待核验片段：按省略号（「……」）拆开分别核验；
 * 引文中残留的 jobkoko `KT` 缺字占位换成通配字符。
 */
export function splitQuoteSegments(quote: string): string[] {
  return quote
    .split(QUOTE_ELLIPSIS_RE)
    .map((segment) => segment.trim())
    .filter((segment) => normalizeForCompare(segment).length > 0)
    .map((segment) => (segment.includes(WILDCARD_CHAR) ? segment : maskJobkokoMissingChars(segment).text))
}

// ---------------------------------------------------------------------------
// 排序工具
// ---------------------------------------------------------------------------

const ID_NUMBER_RE = /^(.*?)(\d+)$/

/** 实体 id 比较：同前缀时按尾部数字升序（songben-2 < songben-10），否则按中文排序 */
export function compareEntityIds(left: string, right: string): number {
  const leftMatch = ID_NUMBER_RE.exec(left)
  const rightMatch = ID_NUMBER_RE.exec(right)
  if (leftMatch && rightMatch && leftMatch[1] === rightMatch[1]) {
    return Number(leftMatch[2]) - Number(rightMatch[2])
  }
  return compareText(left, right)
}

export function compareText(left: string, right: string): number {
  return zhCollator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0)
}
