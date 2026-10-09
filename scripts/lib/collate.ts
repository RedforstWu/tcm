/**
 * 通用校勘：本项目条文 ↔ 见证本全文（Kanripo / jobkoko）的定位、分类、异文片段与汇总统计。
 * 纯函数，不做文件 I/O（异体字表由 text-normalize 惰性读取）；CLI 见 scripts/crosscheck/collate.ts。
 *
 * 缺字处理：规范化前把缺字记号替换为私用区占位字符，替换保持原文长度，原文下标仍可直接使用。
 * - 严格通配 GAP_CHAR：Kanripo `&KR\d+;` 实体与组字式、jobkoko `KT`；与任意一个字等价，删除仍计代价
 * - 可选通配 OPTIONAL_GAP_CHAR：汉字之间的孤立空格（jobkoko 与本项目文本）。它既可能是缺字（「黄 」= 黄芪），
 *   也可能只是方药名之间的分隔，因此可与任意一个字等价，也可零代价删除
 * 文本中原有的其他私用区字符（Kanripo 未编码字）一律按严格通配处理。
 *
 * 坐标约定：points / 下标均为规范串的码点下标；start/end（无 point 前缀）为原文 UTF-16 下标。
 */
import type { EntityEvidenceRecord, EvidenceVerdict, VariantSegment } from './integration-contract.ts'
import type { Evidence } from '../../src/types/data.ts'
import {
  TEXT_VARIANT_RATIO,
  classifyTextMatch,
  editDistance,
  locateInText,
  normalizeForCompare,
  prepareHaystack,
  type NormalizeOptions,
  type NormalizedText,
  type PreparedHaystack,
} from './text-normalize.ts'

/** 严格通配占位字符（私用区，规范化后保留） */
export const GAP_CHAR = '\uE000'
/** 可选通配占位字符 */
export const OPTIONAL_GAP_CHAR = '\uE001'
const OPTIONAL_GAP_CODE_POINT = 0xe001
/** 异文片段中显示缺字的符号 */
export const GAP_DISPLAY_CHAR = '□'
const MASK_FILLER = ' '

/** 规范后短于此长度的条文只做精确定位（含缺字通配的精确定位） */
export const SHORT_NEEDLE_LENGTH = 8
/** 最佳对齐的相似度低于此值视为见证本中找不到（missing），否则按 classifyTextMatch 分类 */
export const MISSING_RATIO_FLOOR = 0.5
/** 单调搜索窗口：从上一条命中末尾回退的码点数 */
export const WINDOW_BACK_SLACK = 64
/** 单调搜索窗口：向前搜索的最少码点数 */
export const WINDOW_FORWARD_MIN = 3_000
/** 单调搜索窗口：向前搜索长度至少为片段长度的倍数 */
export const WINDOW_FORWARD_FACTOR = 3
/** 条文按句读分段定位；单段最大有效长度，限制单次对齐的 DP 规模 */
export const PIECE_LENGTH = 600
/** 单段最小有效长度：更短的句子与后句合并，避免短句在窗口内误配 */
export const MIN_PIECE_LENGTH = 8
/** 见证本在句读边界多出的成段文字达到此长度视为结构性插入（方药、校注、注文） */
export const STRUCTURAL_GAP_MIN = 20
/** 统计精确命中次数的上限 */
export const MAX_COUNTED_HITS = 100
/** 含缺字的短条文：最多验证的候选起点数 */
export const MAX_GAP_EXACT_CANDIDATES = 5_000
/** 含缺字的短条文：通配字数占有效长度的上限，超出视为不可靠命中 */
export const MAX_GAP_EXACT_GAP_SHARE = 0.25
/** 全局回退调用 locateInText 时的最低相似度（之后再用带通配的对齐重算） */
export const GLOBAL_FALLBACK_MIN_RATIO = 0.4
/** 全局回退验证的候选窗口数 */
export const GLOBAL_FALLBACK_CANDIDATES = 4
/** 全局回退命中后精修窗口两侧的最小冗余 */
const REFINE_MIN_SLACK = 16
/** 精修窗口冗余占片段长度的比例 */
const REFINE_SLACK_RATIO = 0.25
/** 带回溯的差异矩阵上限（单元数），超出按比例分块 */
export const MAX_GAP_DIFF_CELLS = 4_000_000
/** ratio 输出保留的小数位 */
const RATIO_DECIMALS = 4
/** 片段起点早于上一片段末尾超过此码点数视为乱序 */
const OUT_OF_ORDER_TOLERANCE = WINDOW_BACK_SLACK

const KANRIPO_GAP_RE = /&KR\d+;|\[[^[\]\n]*[-+][^[\]\n]*\]/g
const JOBKOKO_GAP_RE = /KT ?/g
/** jobkoko 排版标记：方名两侧的 `\x`、图片占位（如 `\ps8a1.bmp\r`）、行首阿拉伯数字条号（如「10．」）；替换为规范化会剔除的零宽空格 */
const JOBKOKO_MARKUP_RE = /\\x|\\\w+\.(?:bmp|jpg|gif|png)(?:\\r)?|^\d+[．.]/gm
const NEUTRAL_FILLER = '\u200B'
export interface ConversionFix {
  wrong: string
  right: string
  /** 仅当全文不含正确词时才修正（误转词本身也可能是正当用法，全文无正确词才说明是整份转换造成的） */
  onlyIfRightAbsent: boolean
}

/**
 * 繁简/词组转换造成的已知误替换（jobkoko 与本项目文本两侧都修正）。仅用于比对，quote 与 variants 仍取原文。
 * 多数 jobkoko 文件经过台湾用语词组转换：「脚气」→「香港脚」、「厚朴」→「浓朴」、「病人」→「病患」；
 * 这些文件中正确词出现 0 次，而未经转换的文件（外台、名医类案、宋本伤寒等）中「病患」本有少量正当用法。
 */
export const JOBKOKO_CONVERSION_FIXES: readonly ConversionFix[] = [
  { wrong: '香港脚', right: '脚气', onlyIfRightAbsent: false },
  { wrong: '浓朴', right: '厚朴', onlyIfRightAbsent: false },
  { wrong: '病患', right: '病人', onlyIfRightAbsent: true },
]
const ISOLATED_SPACE_RE = /(?<=\p{Script=Han})[ \u3000](?=\p{Script=Han})/gu

for (const { wrong, right } of JOBKOKO_CONVERSION_FIXES) {
  if (right.length > wrong.length || right.length === 0) {
    throw new Error(`collate：转换修正「${wrong}→${right}」的正确词须非空且不长于误转词`)
  }
}
if (SHORT_NEEDLE_LENGTH < 1 || MIN_PIECE_LENGTH < SHORT_NEEDLE_LENGTH || PIECE_LENGTH < MIN_PIECE_LENGTH * 2) {
  throw new Error('collate：须满足 SHORT_NEEDLE_LENGTH ≤ MIN_PIECE_LENGTH 且 2×MIN_PIECE_LENGTH ≤ PIECE_LENGTH')
}
if (!(MISSING_RATIO_FLOOR > 0 && MISSING_RATIO_FLOOR < TEXT_VARIANT_RATIO)) {
  throw new Error('collate：MISSING_RATIO_FLOOR 必须在 (0, TEXT_VARIANT_RATIO) 内')
}

// ---------------------------------------------------------------------------
// 缺字掩码
// ---------------------------------------------------------------------------

/** kanripo：实体/组字式；jobkoko：KT 与孤立空格；local：本项目文本，仅孤立空格 */
export type GapScheme = 'kanripo' | 'jobkoko' | 'local'

export interface MaskedText {
  /** 与输入等长 */
  text: string
  strictGaps: number
  optionalGaps: number
  /** 清除的排版标记数（仅 jobkoko） */
  markup: number
  /** 应用的已知转换修正次数（jobkoko 与本项目文本；Kanripo 为繁体原文，不修正） */
  conversionFixes: number
}

function maskJobkokoMarkup(text: string): { text: string; markup: number } {
  let markup = 0
  const current = text.replace(JOBKOKO_MARKUP_RE, (match) => {
    markup += 1
    return NEUTRAL_FILLER.repeat(match.length)
  })
  return { text: current, markup }
}

/** 词组转换误替换修正；onlyIfRightAbsent 以传入的文本单元（见证本全文或单条条文）为判断范围 */
function applyConversionFixes(text: string): { text: string; conversionFixes: number } {
  let current = text
  let conversionFixes = 0
  for (const { wrong, right, onlyIfRightAbsent } of JOBKOKO_CONVERSION_FIXES) {
    if (onlyIfRightAbsent && current.includes(right)) continue
    current = current.replaceAll(wrong, () => {
      conversionFixes += 1
      return right + NEUTRAL_FILLER.repeat(wrong.length - right.length)
    })
  }
  return { text: current, conversionFixes }
}

function maskStrict(text: string, pattern: RegExp): { text: string; count: number } {
  let count = 0
  const masked = text.replace(pattern, (match) => {
    count += 1
    return GAP_CHAR + MASK_FILLER.repeat(match.length - 1)
  })
  return { text: masked, count }
}

/** 把缺字记号替换为占位字符，返回与原文等长的掩码串（下标与原文一一对应） */
export function maskGaps(text: string, scheme: GapScheme): MaskedText {
  if (typeof text !== 'string') throw new TypeError('maskGaps：text 必须是字符串')
  let current = text
  let strictGaps = 0
  let markup = 0
  let conversionFixes = 0
  if (scheme === 'kanripo') {
    const result = maskStrict(current, KANRIPO_GAP_RE)
    current = result.text
    strictGaps += result.count
  } else if (scheme === 'jobkoko') {
    const result = maskStrict(current, JOBKOKO_GAP_RE)
    const cleaned = maskJobkokoMarkup(result.text)
    current = cleaned.text
    strictGaps += result.count
    markup = cleaned.markup
  } else if (scheme !== 'local') {
    throw new Error(`maskGaps：未知 scheme「${String(scheme)}」`)
  }
  // 本项目部分底本（丹溪心法、医宗金鉴、千金方等的维基文本）带有与 jobkoko 相同的词组转换痕迹，两侧同样修正
  if (scheme !== 'kanripo') {
    const fixed = applyConversionFixes(current)
    current = fixed.text
    conversionFixes = fixed.conversionFixes
  }
  let optionalGaps = 0
  if (scheme !== 'kanripo') {
    current = current.replace(ISOLATED_SPACE_RE, () => {
      optionalGaps += 1
      return OPTIONAL_GAP_CHAR
    })
  }
  if (current.length !== text.length) {
    throw new Error('maskGaps：掩码后长度变化，原文下标将失效')
  }
  return { text: current, strictGaps, optionalGaps, markup, conversionFixes }
}

/** 私用区码点（含两个占位字符与 Kanripo 未编码字）均视为通配 */
export function isGapCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
    (codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
    (codePoint >= 0x100000 && codePoint <= 0x10fffd)
  )
}

export function isOptionalGapCodePoint(codePoint: number): boolean {
  return codePoint === OPTIONAL_GAP_CODE_POINT
}

// ---------------------------------------------------------------------------
// 码点数组
// ---------------------------------------------------------------------------

interface PointText {
  points: Int32Array
  /** unitOfPoint[i]：第 i 个码点的 UTF-16 下标；末尾多一项为串长 */
  unitOfPoint: Int32Array
}

function decodePoints(text: string): PointText {
  const points = new Int32Array(text.length)
  const unitOfPoint = new Int32Array(text.length + 1)
  let count = 0
  let unit = 0
  while (unit < text.length) {
    const codePoint = text.codePointAt(unit)!
    points[count] = codePoint
    unitOfPoint[count] = unit
    count += 1
    unit += codePoint > 0xffff ? 2 : 1
  }
  unitOfPoint[count] = text.length
  return { points: points.slice(0, count), unitOfPoint: unitOfPoint.slice(0, count + 1) }
}

function pointsToString(points: Int32Array, display = false): string {
  const parts: string[] = []
  for (const codePoint of points) {
    if (display && isGapCodePoint(codePoint)) {
      if (codePoint !== OPTIONAL_GAP_CODE_POINT) parts.push(GAP_DISPLAY_CHAR)
    } else {
      parts.push(String.fromCodePoint(codePoint))
    }
  }
  return parts.join('')
}

function withoutOptionalGaps(points: Int32Array): string {
  const parts: string[] = []
  for (const codePoint of points) {
    if (codePoint !== OPTIONAL_GAP_CODE_POINT) parts.push(String.fromCodePoint(codePoint))
  }
  return parts.join('')
}

function effectiveLength(points: Int32Array): number {
  let count = 0
  for (const codePoint of points) if (codePoint !== OPTIONAL_GAP_CODE_POINT) count += 1
  return count
}

function containsGap(points: Int32Array): boolean {
  for (const codePoint of points) if (isGapCodePoint(codePoint)) return true
  return false
}

/** 升序数组中第一个 ≥ target 的下标；全部小于时返回 length */
function lowerBound(values: ArrayLike<number>, target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (values[mid]! < target) low = mid + 1
    else high = mid
  }
  return low
}

// ---------------------------------------------------------------------------
// 带通配的编辑距离、半全局对齐与差异
// ---------------------------------------------------------------------------

function substitutionCost(first: number, second: number): number {
  return first === second || isGapCodePoint(first) || isGapCodePoint(second) ? 0 : 1
}

function indelCost(codePoint: number): number {
  return codePoint === OPTIONAL_GAP_CODE_POINT ? 0 : 1
}

/** 带通配的 Levenshtein：通配与任意字替换代价 0，可选通配增删代价 0；O(n·m) 时间、O(min) 空间 */
export function gapAwareDistance(first: Int32Array, second: Int32Array): number {
  let prefix = 0
  const minLength = Math.min(first.length, second.length)
  while (prefix < minLength && first[prefix] === second[prefix]) prefix += 1
  let firstEnd = first.length
  let secondEnd = second.length
  while (firstEnd > prefix && secondEnd > prefix && first[firstEnd - 1] === second[secondEnd - 1]) {
    firstEnd -= 1
    secondEnd -= 1
  }
  const rows = first.subarray(prefix, firstEnd)
  const columns = second.subarray(prefix, secondEnd)
  let previous = new Int32Array(columns.length + 1)
  let current = new Int32Array(columns.length + 1)
  for (let column = 1; column <= columns.length; column += 1) {
    previous[column] = previous[column - 1]! + indelCost(columns[column - 1]!)
  }
  for (let row = 1; row <= rows.length; row += 1) {
    const rowChar = rows[row - 1]!
    const rowDelete = indelCost(rowChar)
    current[0] = previous[0]! + rowDelete
    for (let column = 1; column <= columns.length; column += 1) {
      const columnChar = columns[column - 1]!
      const substitute = previous[column - 1]! + substitutionCost(rowChar, columnChar)
      const remove = previous[column]! + rowDelete
      const insert = current[column - 1]! + indelCost(columnChar)
      current[column] = substitute < remove ? (substitute < insert ? substitute : insert) : remove < insert ? remove : insert
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[columns.length]!
}

/** 相似度 = 1 - 距离 / max(有效长度)；有效长度不计可选通配；两侧均为空时返回 1 */
export function gapAwareRatio(first: Int32Array, second: Int32Array): number {
  const longest = Math.max(effectiveLength(first), effectiveLength(second))
  if (longest === 0) return 1
  return Math.max(0, 1 - gapAwareDistance(first, second) / longest)
}

export interface AlignmentSpan {
  /** 编辑距离（带通配） */
  cost: number
  /** 窗口内码点下标 [start, end) */
  start: number
  end: number
}

/**
 * 半全局对齐：needle 必须完整参与，window 两端可自由截取；带通配代价规则。
 * 等代价时优先跨度与 needle 长度最接近、其次更靠前的终点（单调顺序更近）。O(m·w)。
 */
export function semiGlobalGapAlign(needle: Int32Array, window: Int32Array): AlignmentSpan {
  const needleLength = needle.length
  const deleteCosts = new Uint8Array(needleLength)
  for (let row = 0; row < needleLength; row += 1) deleteCosts[row] = indelCost(needle[row]!)
  const needleIsGap = new Uint8Array(needleLength)
  for (let row = 0; row < needleLength; row += 1) needleIsGap[row] = isGapCodePoint(needle[row]!) ? 1 : 0

  let previousCost = new Int32Array(needleLength + 1)
  let currentCost = new Int32Array(needleLength + 1)
  let previousStart = new Int32Array(needleLength + 1)
  let currentStart = new Int32Array(needleLength + 1)
  for (let row = 1; row <= needleLength; row += 1) previousCost[row] = previousCost[row - 1]! + deleteCosts[row - 1]!
  let best: AlignmentSpan = { cost: previousCost[needleLength]!, start: 0, end: 0 }

  for (let column = 1; column <= window.length; column += 1) {
    const windowChar = window[column - 1]!
    const windowIsGap = isGapCodePoint(windowChar)
    const insertCost = windowChar === OPTIONAL_GAP_CODE_POINT ? 0 : 1
    currentCost[0] = 0
    currentStart[0] = column
    for (let row = 1; row <= needleLength; row += 1) {
      const matches = windowIsGap || needleIsGap[row - 1] === 1 || needle[row - 1] === windowChar
      let cost = previousCost[row - 1]! + (matches ? 0 : 1)
      let start = previousStart[row - 1]!
      const skipWindowChar = previousCost[row]! + insertCost
      if (skipWindowChar < cost) {
        cost = skipWindowChar
        start = previousStart[row]!
      }
      const skipNeedleChar = currentCost[row - 1]! + deleteCosts[row - 1]!
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
    const costSwap = previousCost
    previousCost = currentCost
    currentCost = costSwap
    const startSwap = previousStart
    previousStart = currentStart
    currentStart = startSwap
  }
  return best
}

/** 差异段（码点下标，左闭右开）；equal 段可能含通配命中或零代价删除的可选通配 */
export interface DiffRun {
  op: VariantSegment['op']
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
}

const STEP_EQUAL = 0
const STEP_DIFF = 1

class RunBuilder {
  readonly runs: DiffRun[] = []
  private kind = -1
  private runA = 0
  private runB = 0
  private positionA: number
  private positionB: number

  constructor(baseA: number, baseB: number) {
    this.positionA = baseA
    this.positionB = baseB
  }

  advance(kind: number, countA: number, countB: number): void {
    if (countA === 0 && countB === 0) return
    if (kind !== this.kind) {
      this.flush()
      this.kind = kind
      this.runA = this.positionA
      this.runB = this.positionB
    }
    this.positionA += countA
    this.positionB += countB
  }

  flush(): void {
    if (this.kind < 0) return
    const lengthA = this.positionA - this.runA
    const lengthB = this.positionB - this.runB
    const op: DiffRun['op'] =
      this.kind === STEP_EQUAL ? 'equal' : lengthA > 0 && lengthB > 0 ? 'replace' : lengthA > 0 ? 'delete' : 'insert'
    this.runs.push({ op, aStart: this.runA, aEnd: this.positionA, bStart: this.runB, bEnd: this.positionB })
    this.kind = -1
  }
}

function diffMatrixInto(first: Int32Array, second: Int32Array, builder: RunBuilder): void {
  const rows = first.length
  const columns = second.length
  const stride = columns + 1
  const table = new Int32Array((rows + 1) * stride)
  for (let column = 1; column <= columns; column += 1) table[column] = table[column - 1]! + indelCost(second[column - 1]!)
  for (let row = 1; row <= rows; row += 1) {
    const base = row * stride
    const previousBase = base - stride
    const rowChar = first[row - 1]!
    const rowDelete = indelCost(rowChar)
    table[base] = table[previousBase]! + rowDelete
    for (let column = 1; column <= columns; column += 1) {
      const columnChar = second[column - 1]!
      const substitute = table[previousBase + column - 1]! + substitutionCost(rowChar, columnChar)
      const remove = table[previousBase + column]! + rowDelete
      const insert = table[base + column - 1]! + indelCost(columnChar)
      table[base + column] =
        substitute < remove ? (substitute < insert ? substitute : insert) : remove < insert ? remove : insert
    }
  }

  // 回溯：步骤记为 (kind, countA, countB)，逆序存放
  const kinds = new Uint8Array(rows + columns)
  const movesA = new Uint8Array(rows + columns)
  const movesB = new Uint8Array(rows + columns)
  let stepCount = 0
  let row = rows
  let column = columns
  while (row > 0 || column > 0) {
    const value = table[row * stride + column]!
    if (row > 0 && column > 0) {
      const cost = substitutionCost(first[row - 1]!, second[column - 1]!)
      if (cost === 0 && value === table[(row - 1) * stride + column - 1]!) {
        kinds[stepCount] = STEP_EQUAL
        movesA[stepCount] = 1
        movesB[stepCount++] = 1
        row -= 1
        column -= 1
        continue
      }
    }
    if (row > 0 && indelCost(first[row - 1]!) === 0 && value === table[(row - 1) * stride + column]!) {
      kinds[stepCount] = STEP_EQUAL
      movesA[stepCount] = 1
      movesB[stepCount++] = 0
      row -= 1
      continue
    }
    if (column > 0 && indelCost(second[column - 1]!) === 0 && value === table[row * stride + column - 1]!) {
      kinds[stepCount] = STEP_EQUAL
      movesA[stepCount] = 0
      movesB[stepCount++] = 1
      column -= 1
      continue
    }
    if (row > 0 && column > 0 && value === table[(row - 1) * stride + column - 1]! + 1) {
      kinds[stepCount] = STEP_DIFF
      movesA[stepCount] = 1
      movesB[stepCount++] = 1
      row -= 1
      column -= 1
      continue
    }
    if (row > 0 && value === table[(row - 1) * stride + column]! + 1) {
      kinds[stepCount] = STEP_DIFF
      movesA[stepCount] = 1
      movesB[stepCount++] = 0
      row -= 1
      continue
    }
    kinds[stepCount] = STEP_DIFF
    movesA[stepCount] = 0
    movesB[stepCount++] = 1
    column -= 1
  }
  for (let step = stepCount - 1; step >= 0; step -= 1) {
    builder.advance(kinds[step]!, movesA[step]!, movesB[step]!)
  }
}

function diffRangeInto(first: Int32Array, second: Int32Array, builder: RunBuilder): void {
  if (first.length === 0 || second.length === 0) {
    builder.advance(STEP_DIFF, first.length, second.length)
    return
  }
  if (first.length * second.length <= MAX_GAP_DIFF_CELLS) {
    diffMatrixInto(first, second, builder)
    return
  }
  const chunkCount = Math.ceil((first.length * second.length) / MAX_GAP_DIFF_CELLS) + 1
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    diffRangeInto(
      first.subarray(Math.floor((first.length * chunk) / chunkCount), Math.floor((first.length * (chunk + 1)) / chunkCount)),
      second.subarray(Math.floor((second.length * chunk) / chunkCount), Math.floor((second.length * (chunk + 1)) / chunkCount)),
      builder,
    )
  }
}

/** 带通配的逐字差异，下标加上 baseA/baseB 后返回；相邻同类步骤合并 */
export function gapAwareDiff(first: Int32Array, second: Int32Array, baseA = 0, baseB = 0): DiffRun[] {
  const builder = new RunBuilder(baseA, baseB)
  diffRangeInto(first, second, builder)
  builder.flush()
  return builder.runs
}

// ---------------------------------------------------------------------------
// 见证本与条文的预处理
// ---------------------------------------------------------------------------

export interface GapCounts {
  /** 严格通配（含原有私用区字符） */
  strict: number
  /** 可选通配（孤立空格） */
  optional: number
}

export interface CollationHaystack {
  /** 原始全文（未掩码），quote 与 locator 均基于它 */
  readonly source: string
  readonly scheme: GapScheme
  /** 基于掩码文本的 PreparedHaystack（全局回退时交给 locateInText） */
  readonly prepared: PreparedHaystack
  readonly points: Int32Array
  readonly unitOfPoint: Int32Array
  /** 去掉可选通配后的规范串，用于精确查找 */
  readonly compact: string
  /** compactPoint[u]：compact 第 u 个 UTF-16 码元对应的码点下标；末尾多一项为 points.length */
  readonly compactPoint: Int32Array
  /** 严格通配所在码点下标（升序） */
  readonly strictGapPoints: Int32Array
  readonly gapCounts: GapCounts
  /** 掩码阶段清除的排版标记与已知转换修正次数 */
  readonly cleanup: { markup: number; conversionFixes: number }
}

function buildCompact(points: Int32Array): { compact: string; compactPoint: Int32Array } {
  const parts: string[] = []
  const mapping: number[] = []
  for (let index = 0; index < points.length; index += 1) {
    const codePoint = points[index]!
    if (codePoint === OPTIONAL_GAP_CODE_POINT) continue
    const char = String.fromCodePoint(codePoint)
    parts.push(char)
    for (let unit = 0; unit < char.length; unit += 1) mapping.push(index)
  }
  mapping.push(points.length)
  return { compact: parts.join(''), compactPoint: Int32Array.from(mapping) }
}

function countGaps(points: Int32Array): { counts: GapCounts; strictPoints: Int32Array } {
  const strictPoints: number[] = []
  let optional = 0
  for (let index = 0; index < points.length; index += 1) {
    const codePoint = points[index]!
    if (codePoint === OPTIONAL_GAP_CODE_POINT) optional += 1
    else if (isGapCodePoint(codePoint)) strictPoints.push(index)
  }
  return { counts: { strict: strictPoints.length, optional }, strictPoints: Int32Array.from(strictPoints) }
}

/** 每个见证本调用一次：掩码 → prepareHaystack → 码点数组与紧凑串 */
export function prepareCollationHaystack(
  source: string,
  scheme: GapScheme,
  options: NormalizeOptions = {},
): CollationHaystack {
  const masked = maskGaps(source, scheme)
  const prepared = prepareHaystack(masked.text, options)
  const decoded = decodePoints(prepared.normalized.text)
  const { compact, compactPoint } = buildCompact(decoded.points)
  const gaps = countGaps(decoded.points)
  return {
    source,
    scheme,
    prepared,
    points: decoded.points,
    unitOfPoint: decoded.unitOfPoint,
    compact,
    compactPoint,
    strictGapPoints: gaps.strictPoints,
    gapCounts: gaps.counts,
    cleanup: { markup: masked.markup, conversionFixes: masked.conversionFixes },
  }
}

export interface CollationNeedle {
  readonly source: string
  readonly normalized: NormalizedText
  readonly points: Int32Array
  readonly unitOfPoint: Int32Array
  /** 去掉可选通配后的规范串 */
  readonly compact: string
  /** 不计可选通配的码点数 */
  readonly effectiveLength: number
  readonly gapCounts: GapCounts
}

/** 预处理本项目条文；规范化选项须与见证本一致 */
export function prepareCollationNeedle(text: string, options: NormalizeOptions = {}): CollationNeedle {
  const masked = maskGaps(text, 'local')
  const normalized = normalizeForCompare(masked.text, {
    stripNotes: options.stripNotes ?? false,
    mergeZhengZheng: options.mergeZhengZheng ?? false,
    withOffsets: true,
  })
  const decoded = decodePoints(normalized.text)
  const gaps = countGaps(decoded.points)
  return {
    source: text,
    normalized,
    points: decoded.points,
    unitOfPoint: decoded.unitOfPoint,
    compact: withoutOptionalGaps(decoded.points),
    effectiveLength: effectiveLength(decoded.points),
    gapCounts: gaps.counts,
  }
}

/** 码点 [pointStart, pointEnd) → 原文区间 */
function originalRange(
  normalized: NormalizedText,
  unitOfPoint: Int32Array,
  pointStart: number,
  pointEnd: number,
): { start: number; end: number } {
  if (pointEnd <= pointStart) throw new RangeError(`originalRange：空区间 [${pointStart}, ${pointEnd})`)
  return {
    start: normalized.offsetMap[unitOfPoint[pointStart]!]!,
    end: normalized.offsetEndMap[unitOfPoint[pointEnd]! - 1]!,
  }
}

/** 原文区间 → 覆盖它的码点区间（用于 locateInText 的结果）；无覆盖时返回 null */
function pointRangeOfOriginal(haystack: CollationHaystack, start: number, end: number): { start: number; end: number } | null {
  const { offsetMap, offsetEndMap } = haystack.prepared.normalized
  const firstUnit = lowerBound(offsetMap, start)
  // offsetEndMap 同样非降：最后一个 ≤ end 的码元
  const lastUnit = lowerBound(offsetEndMap, end + 1) - 1
  if (firstUnit >= offsetMap.length || lastUnit < firstUnit) return null
  const pointStart = lowerBound(haystack.unitOfPoint, firstUnit + 1) - 1
  const pointEnd = lowerBound(haystack.unitOfPoint, lastUnit + 1)
  return pointEnd > pointStart ? { start: Math.max(0, pointStart), end: Math.min(haystack.points.length, pointEnd) } : null
}

// ---------------------------------------------------------------------------
// 定位
// ---------------------------------------------------------------------------

/** 升序候选中按单调顺序选最近的一处：第一个 ≥ cursor - backSlack 的位置；都在之前则取最后一个 */
export function pickMonotonicHit(sortedPositions: readonly number[], cursor: number, backSlack = WINDOW_BACK_SLACK): number {
  if (sortedPositions.length === 0) throw new RangeError('pickMonotonicHit：候选为空')
  for (let index = 1; index < sortedPositions.length; index += 1) {
    if (sortedPositions[index]! < sortedPositions[index - 1]!) throw new Error('pickMonotonicHit：候选必须升序')
  }
  const index = lowerBound(sortedPositions, cursor - backSlack)
  return index < sortedPositions.length ? index : sortedPositions.length - 1
}

/** 单调搜索窗口（码点下标，左闭右开） */
export function monotonicWindow(
  cursor: number,
  needleLength: number,
  haystackLength: number,
  settings: Pick<CollationSettings, 'backSlack' | 'forwardMin'> = DEFAULT_SETTINGS,
): { start: number; end: number } {
  const start = Math.max(0, Math.min(haystackLength, cursor - settings.backSlack))
  const forward = Math.max(settings.forwardMin, needleLength * WINDOW_FORWARD_FACTOR)
  return { start, end: Math.min(haystackLength, Math.max(start, cursor) + forward) }
}

export interface CollationSettings {
  backSlack: number
  forwardMin: number
  /** 分段的最大有效长度（无句读时强制切分） */
  pieceLength: number
  /** 分段的最小有效长度（短句与后句合并） */
  minPieceLength: number
  shortLength: number
  /** 见证本在句读边界多出的成段文字达到此长度时视为结构性插入，不计入 ratio */
  structuralGapMin: number
}

export const DEFAULT_SETTINGS: Readonly<CollationSettings> = {
  backSlack: WINDOW_BACK_SLACK,
  forwardMin: WINDOW_FORWARD_MIN,
  pieceLength: PIECE_LENGTH,
  minPieceLength: MIN_PIECE_LENGTH,
  shortLength: SHORT_NEEDLE_LENGTH,
  structuralGapMin: STRUCTURAL_GAP_MIN,
}

export type MatchStrategy = 'exact' | 'gap-exact' | 'window' | 'global'

export interface PieceMatch {
  /** 条文规范串码点区间 */
  needleStart: number
  needleEnd: number
  /** 本段止于句读（。；！？或换行），而非按长度强制切分 */
  sentenceEnd: boolean
  /** 见证本规范串码点区间；未命中为 null */
  pointStart: number | null
  pointEnd: number | null
  /** 带通配距离；未命中时为片段有效长度 */
  distance: number
  /** 不通配时的距离（仅含缺字时与 distance 不同） */
  plainDistance: number
  /** 见证本命中段有效长度 */
  spanLength: number
  ratio: number
  /** 未命中时最佳候选的相似度（诊断用） */
  bestRatio: number
}

export interface ClauseMatch {
  found: boolean
  /** 带通配相似度；未找到为 0 */
  ratio: number
  /** 不通配时的相似度 */
  plainRatio: number
  exact: boolean
  strategy: MatchStrategy | 'pieces' | null
  /** 单调窗口内未找到，经 locateInText 全局锚定后命中 */
  viaGlobal: boolean
  /** 见证本在分段之间多出的结构性插入（方药、校注等）段数与有效字数，未计入 ratio */
  structuralGaps: number
  structuralChars: number
  /** 见证本规范串码点区间（found 时有效） */
  pointStart: number
  pointEnd: number
  /** 见证本原文区间（found 时有效） */
  start: number
  end: number
  /** 精确命中次数（上限 MAX_COUNTED_HITS） */
  hitCount: number
  pieces: PieceMatch[]
  matchedPieces: number
  outOfOrder: boolean
  /** 未找到时各片段最佳候选相似度的最大值（诊断用） */
  bestRatio: number
}

function compactUnitAtOrAfterPoint(haystack: CollationHaystack, point: number): number {
  return lowerBound(haystack.compactPoint, point)
}

function countOccurrences(text: string, pattern: string, limit: number): number {
  let count = 0
  let from = 0
  while (count < limit) {
    const index = text.indexOf(pattern, from)
    if (index < 0) break
    count += 1
    from = index + 1
  }
  return count
}

interface ExactHit {
  pointStart: number
  pointEnd: number
  count: number
}

/** 在紧凑串中精确查找：优先单调顺序上 cursor 之后的第一处，否则取 cursor 之前最近的一处 */
function findExactHit(needle: CollationNeedle, haystack: CollationHaystack, cursor: number, backSlack: number): ExactHit | null {
  const pattern = needle.compact
  if (pattern.length === 0) return null
  const fromUnit = compactUnitAtOrAfterPoint(haystack, Math.max(0, cursor - backSlack))
  let unit = haystack.compact.indexOf(pattern, fromUnit)
  if (unit < 0) unit = fromUnit > 0 ? haystack.compact.lastIndexOf(pattern, fromUnit - 1) : -1
  if (unit < 0) return null
  return {
    pointStart: haystack.compactPoint[unit]!,
    pointEnd: haystack.compactPoint[unit + pattern.length - 1]! + 1,
    count: countOccurrences(haystack.compact, pattern, MAX_COUNTED_HITS),
  }
}

/** 最长的不含通配的片段（码点下标区间） */
function longestGapFreeRun(points: Int32Array): { start: number; end: number } {
  let best = { start: 0, end: 0 }
  let runStart = 0
  for (let index = 0; index <= points.length; index += 1) {
    if (index === points.length || isGapCodePoint(points[index]!)) {
      if (index - runStart > best.end - best.start) best = { start: runStart, end: index }
      runStart = index + 1
    }
  }
  return best
}

/** 短条文的带通配精确定位：候选来自见证本严格通配位置与条文最长无通配片段的出现位置，逐一验证距离为 0 */
function findGapExactHit(needle: CollationNeedle, haystack: CollationHaystack, cursor: number, backSlack: number): ExactHit | null {
  const needlePoints = needle.points
  const needleLength = needlePoints.length
  const candidateStarts = new Set<number>()
  const addAround = (point: number, offsetInNeedle: number) => {
    if (candidateStarts.size >= MAX_GAP_EXACT_CANDIDATES) return
    candidateStarts.add(Math.max(0, point - offsetInNeedle - 1))
  }
  if (haystack.strictGapPoints.length > 0) {
    // 先按离 cursor 由近到远收集，候选上限内优先保留单调顺序附近的位置
    const gapPoints = haystack.strictGapPoints
    const center = lowerBound(gapPoints, Math.max(0, cursor - backSlack))
    for (let step = 0; candidateStarts.size < MAX_GAP_EXACT_CANDIDATES; step += 1) {
      const after = center + step
      const before = center - step - 1
      if (after >= gapPoints.length && before < 0) break
      for (const index of [after, before]) {
        if (index < 0 || index >= gapPoints.length) continue
        for (let offset = 0; offset < needleLength; offset += 1) addAround(gapPoints[index]!, offset)
      }
    }
  }
  if (needle.gapCounts.strict > 0) {
    const run = longestGapFreeRun(needlePoints)
    if (run.end - run.start >= 2) {
      const fragment = pointsToString(needlePoints.subarray(run.start, run.end))
      let from = 0
      while (candidateStarts.size < MAX_GAP_EXACT_CANDIDATES) {
        const unit = haystack.compact.indexOf(fragment, from)
        if (unit < 0) break
        addAround(haystack.compactPoint[unit]!, run.start)
        from = unit + 1
      }
    }
  }
  if (candidateStarts.size === 0) return null

  const hits: Array<{ start: number; end: number }> = []
  const windowExtra = needleLength + 2
  const maxGaps = Math.max(1, Math.floor(needle.effectiveLength * MAX_GAP_EXACT_GAP_SHARE))
  for (const candidate of [...candidateStarts].sort((left, right) => left - right)) {
    const windowEnd = Math.min(haystack.points.length, candidate + windowExtra + needle.gapCounts.optional)
    const span = semiGlobalGapAlign(needlePoints, haystack.points.subarray(candidate, windowEnd))
    if (span.cost !== 0 || span.end <= span.start) continue
    const start = candidate + span.start
    const end = candidate + span.end
    const spanGaps = countGaps(haystack.points.subarray(start, end)).counts.strict
    if (spanGaps + needle.gapCounts.strict > maxGaps) continue
    const last = hits[hits.length - 1]
    if (!last || last.start !== start) hits.push({ start, end })
  }
  if (hits.length === 0) return null
  hits.sort((left, right) => left.start - right.start || left.end - right.end)
  const chosen = hits[pickMonotonicHit(hits.map((hit) => hit.start), cursor, backSlack)]!
  return { pointStart: chosen.start, pointEnd: chosen.end, count: Math.min(hits.length, MAX_COUNTED_HITS) }
}

const SENTENCE_BREAK_RE = /[。；！？!?;\n]/

/** sentenceBreaks[i] = 1 表示原文中第 i 个规范码点之后、下一个码点之前有句读 */
export function sentenceBreaks(needle: CollationNeedle): Uint8Array {
  const breaks = new Uint8Array(needle.points.length)
  const { offsetMap, offsetEndMap } = needle.normalized
  for (let index = 0; index + 1 < needle.points.length; index += 1) {
    const from = offsetEndMap[needle.unitOfPoint[index]!]!
    const to = offsetMap[needle.unitOfPoint[index + 1]!]!
    if (to > from && SENTENCE_BREAK_RE.test(needle.source.slice(from, to))) breaks[index] = 1
  }
  return breaks
}

export interface PieceBounds {
  start: number
  end: number
  sentenceEnd: boolean
}

/**
 * 按句读分段：在句读处收段，但每段有效长度不少于 minPieceLength；无句读时满 pieceLength 强制切分。
 * 末尾不足 minPieceLength 的残段并入前一段。
 */
export function pieceBoundaries(
  needle: CollationNeedle,
  settings: Pick<CollationSettings, 'pieceLength' | 'minPieceLength'> = DEFAULT_SETTINGS,
): PieceBounds[] {
  const total = needle.points.length
  if (needle.effectiveLength < settings.minPieceLength * 2) return [{ start: 0, end: total, sentenceEnd: true }]
  const breaks = sentenceBreaks(needle)
  const pieces: PieceBounds[] = []
  let start = 0
  let counted = 0
  for (let index = 0; index < total; index += 1) {
    if (needle.points[index] !== OPTIONAL_GAP_CODE_POINT) counted += 1
    const atBreak = breaks[index] === 1
    if ((atBreak && counted >= settings.minPieceLength) || counted >= settings.pieceLength) {
      pieces.push({ start, end: index + 1, sentenceEnd: atBreak })
      start = index + 1
      counted = 0
    }
  }
  if (start < total) {
    const last = pieces[pieces.length - 1]
    if (last && counted < settings.minPieceLength) {
      last.end = total
      last.sentenceEnd = true
    } else {
      pieces.push({ start, end: total, sentenceEnd: true })
    }
  }
  return pieces
}

function scoreSpan(piece: Int32Array, haystack: CollationHaystack, pointStart: number, pointEnd: number, cost: number) {
  const span = haystack.points.subarray(pointStart, pointEnd)
  const spanLength = effectiveLength(span)
  const longest = Math.max(effectiveLength(piece), spanLength)
  const ratio = longest === 0 ? 1 : Math.max(0, 1 - cost / longest)
  let plainDistance = cost
  if (containsGap(piece) || containsGap(span)) {
    plainDistance = editDistance(withoutOptionalGaps(piece), withoutOptionalGaps(span))
  }
  return { spanLength, ratio, plainDistance }
}

function alignInRange(piece: Int32Array, haystack: CollationHaystack, rangeStart: number, rangeEnd: number) {
  const span = semiGlobalGapAlign(piece, haystack.points.subarray(rangeStart, rangeEnd))
  if (span.end <= span.start) return null
  const pointStart = rangeStart + span.start
  const pointEnd = rangeStart + span.end
  return { pointStart, pointEnd, cost: span.cost, ...scoreSpan(piece, haystack, pointStart, pointEnd, span.cost) }
}

/** 在单调窗口内定位一段；相似度低于 MISSING_RATIO_FLOOR 记为未命中 */
function locatePieceInWindow(
  needle: CollationNeedle,
  bounds: PieceBounds,
  haystack: CollationHaystack,
  cursor: number,
  settings: CollationSettings,
): PieceMatch {
  const piece = needle.points.subarray(bounds.start, bounds.end)
  const pieceLength = effectiveLength(piece)
  const unmatched = (bestRatio: number): PieceMatch => ({
    needleStart: bounds.start,
    needleEnd: bounds.end,
    sentenceEnd: bounds.sentenceEnd,
    pointStart: null,
    pointEnd: null,
    distance: pieceLength,
    plainDistance: pieceLength,
    spanLength: 0,
    ratio: 0,
    bestRatio,
  })
  if (pieceLength === 0) return unmatched(0)
  const window = monotonicWindow(cursor, piece.length, haystack.points.length, settings)
  const hit = window.end > window.start ? alignInRange(piece, haystack, window.start, window.end) : null
  if (!hit || hit.ratio < MISSING_RATIO_FLOOR) return unmatched(hit?.ratio ?? 0)
  return {
    needleStart: bounds.start,
    needleEnd: bounds.end,
    sentenceEnd: bounds.sentenceEnd,
    pointStart: hit.pointStart,
    pointEnd: hit.pointEnd,
    distance: hit.cost,
    plainDistance: hit.plainDistance,
    spanLength: hit.spanLength,
    ratio: hit.ratio,
    bestRatio: hit.ratio,
  }
}

/** 各段依次在单调窗口内定位；只有相似度 ≥ TEXT_VARIANT_RATIO 的段才推进游标，避免误配把后续段带偏 */
function windowPass(
  needle: CollationNeedle,
  bounds: readonly PieceBounds[],
  haystack: CollationHaystack,
  cursor: number,
  settings: CollationSettings,
): PieceMatch[] {
  const pieces: PieceMatch[] = []
  let pieceCursor = cursor
  for (const piece of bounds) {
    const match = locatePieceInWindow(needle, piece, haystack, pieceCursor, settings)
    pieces.push(match)
    if (match.pointEnd !== null && match.ratio >= TEXT_VARIANT_RATIO) pieceCursor = match.pointEnd
  }
  return pieces
}

/** 用 locateInText 在全文中锚定某一段，返回据此估计的条文起点游标（码点下标） */
function globalAnchorCursor(
  needle: CollationNeedle,
  bounds: PieceBounds,
  haystack: CollationHaystack,
  settings: CollationSettings,
): number | null {
  const piece = needle.points.subarray(bounds.start, bounds.end)
  if (effectiveLength(piece) < settings.shortLength) return null
  const located = locateInText(pointsToString(piece), haystack.prepared, {
    minRatio: GLOBAL_FALLBACK_MIN_RATIO,
    maxCandidates: GLOBAL_FALLBACK_CANDIDATES,
  })
  const range = located ? pointRangeOfOriginal(haystack, located.start, located.end) : null
  if (!range) return null
  const before = effectiveLength(needle.points.subarray(0, bounds.start))
  const slack = Math.max(REFINE_MIN_SLACK, Math.ceil(piece.length * REFINE_SLACK_RATIO))
  return Math.max(0, range.start - before - slack + settings.backSlack)
}

function emptyMatch(): ClauseMatch {
  return {
    found: false,
    ratio: 0,
    plainRatio: 0,
    exact: false,
    strategy: null,
    viaGlobal: false,
    structuralGaps: 0,
    structuralChars: 0,
    pointStart: 0,
    pointEnd: 0,
    start: 0,
    end: 0,
    hitCount: 0,
    pieces: [],
    matchedPieces: 0,
    outOfOrder: false,
    bestRatio: 0,
  }
}

function exactMatch(haystack: CollationHaystack, hit: ExactHit, strategy: MatchStrategy): ClauseMatch {
  const range = originalRange(haystack.prepared.normalized, haystack.unitOfPoint, hit.pointStart, hit.pointEnd)
  return {
    ...emptyMatch(),
    found: true,
    ratio: 1,
    plainRatio: 1,
    exact: true,
    strategy,
    pointStart: hit.pointStart,
    pointEnd: hit.pointEnd,
    start: range.start,
    end: range.end,
    hitCount: hit.count,
    matchedPieces: 1,
    bestRatio: 1,
  }
}

function asUnmatched(piece: PieceMatch, needle: CollationNeedle): PieceMatch {
  const pieceLength = effectiveLength(needle.points.subarray(piece.needleStart, piece.needleEnd))
  return { ...piece, pointStart: null, pointEnd: null, distance: pieceLength, plainDistance: pieceLength, spanLength: 0, ratio: 0 }
}

/**
 * 弱命中段（ratio < TEXT_VARIANT_RATIO）若早于前一可靠段末尾，或与之相距超过 max(段长, backSlack)，
 * 多为窗口内的偶然近似，降级为未命中；没有前一可靠段时以后一可靠段为参照。
 */
export function demoteStrayPieces(
  needle: CollationNeedle,
  pieces: readonly PieceMatch[],
  backSlack: number,
): PieceMatch[] {
  const reliable = (piece: PieceMatch | undefined) =>
    piece !== undefined && piece.pointStart !== null && piece.ratio >= TEXT_VARIANT_RATIO
  return pieces.map((piece, index) => {
    if (piece.pointStart === null || piece.pointEnd === null || piece.ratio >= TEXT_VARIANT_RATIO) return piece
    const allowance = Math.max(piece.needleEnd - piece.needleStart, backSlack)
    let previousIndex = index - 1
    while (previousIndex >= 0 && !reliable(pieces[previousIndex])) previousIndex -= 1
    if (previousIndex >= 0) {
      const previousEnd = pieces[previousIndex]!.pointEnd!
      const offset = piece.pointStart - previousEnd
      return offset < -OUT_OF_ORDER_TOLERANCE || offset > allowance ? asUnmatched(piece, needle) : piece
    }
    let nextIndex = index + 1
    while (nextIndex < pieces.length && !reliable(pieces[nextIndex])) nextIndex += 1
    if (nextIndex < pieces.length) {
      const offset = pieces[nextIndex]!.pointStart! - piece.pointEnd
      return offset < -OUT_OF_ORDER_TOLERANCE || offset > allowance ? asUnmatched(piece, needle) : piece
    }
    return piece
  })
}

/**
 * 汇总分段结果：距离 = 各段距离 + 段间见证本多出的文字；相似度按整条有效长度计算。
 * 段间夹有未命中段时，段间文字与未命中段视为互相替换，代价取两者较大值而非相加。
 * 段间多出的文字满足「前段止于句读、前后两段均 ≥ TEXT_VARIANT_RATIO 且相邻、长度 ≥ structuralGapMin」时
 * 视为结构性插入（本项目把方药/校注拆出或合并了条文），不计入距离与跨度，只计数。
 */
export function aggregatePieces(
  needle: CollationNeedle,
  haystack: CollationHaystack,
  rawPieces: PieceMatch[],
  settings: Pick<CollationSettings, 'structuralGapMin' | 'backSlack'> = DEFAULT_SETTINGS,
): ClauseMatch {
  const bestRatio = Math.max(0, ...rawPieces.map((piece) => piece.bestRatio))
  const pieces = demoteStrayPieces(needle, rawPieces, settings.backSlack)
  const matched = pieces.filter((piece) => piece.pointStart !== null)
  if (matched.length === 0) return { ...emptyMatch(), pieces, bestRatio }

  let outOfOrder = false
  let distance = 0
  let plainDistance = 0
  let spanLength = 0
  let structuralGaps = 0
  let structuralChars = 0
  let previous: PieceMatch | null = null
  let pendingUnmatched = 0
  for (const piece of pieces) {
    distance += piece.distance
    plainDistance += piece.plainDistance
    if (piece.pointStart === null || piece.pointEnd === null) {
      if (previous !== null) pendingUnmatched += piece.distance
      continue
    }
    spanLength += piece.spanLength
    if (previous !== null && previous.pointEnd !== null) {
      if (piece.pointStart < previous.pointEnd - OUT_OF_ORDER_TOLERANCE) {
        outOfOrder = true
      } else if (piece.pointStart > previous.pointEnd) {
        const between = effectiveLength(haystack.points.subarray(previous.pointEnd, piece.pointStart))
        const structural =
          pendingUnmatched === 0 &&
          between >= settings.structuralGapMin &&
          previous.sentenceEnd &&
          previous.ratio >= TEXT_VARIANT_RATIO &&
          piece.ratio >= TEXT_VARIANT_RATIO
        if (structural) {
          structuralGaps += 1
          structuralChars += between
        } else {
          const extra = Math.max(0, between - pendingUnmatched)
          distance += extra
          plainDistance += extra
          spanLength += between
        }
      }
    }
    previous = piece
    pendingUnmatched = 0
  }
  const longest = Math.max(needle.effectiveLength, spanLength)
  const ratio = longest === 0 ? 1 : Math.max(0, 1 - distance / longest)
  const plainRatio = longest === 0 ? 1 : Math.max(0, 1 - plainDistance / longest)
  // 容差内的轻微倒退不算乱序，但末段终点可能早于首段起点，故始终取并集区间
  let pointStart = matched[0]!.pointStart!
  let pointEnd = matched[0]!.pointEnd!
  for (const piece of matched) {
    pointStart = Math.min(pointStart, piece.pointStart!)
    pointEnd = Math.max(pointEnd, piece.pointEnd!)
  }
  const range = originalRange(haystack.prepared.normalized, haystack.unitOfPoint, pointStart, pointEnd)
  return {
    found: true,
    ratio,
    plainRatio,
    exact: false,
    strategy: pieces.length > 1 ? 'pieces' : 'window',
    viaGlobal: false,
    structuralGaps,
    structuralChars,
    pointStart,
    pointEnd,
    start: range.start,
    end: range.end,
    hitCount: 0,
    pieces,
    matchedPieces: matched.length,
    outOfOrder,
    bestRatio,
  }
}

/** 在见证本中定位一条条文；cursor 为上一条命中末尾（码点下标） */
export function locateClause(
  needle: CollationNeedle,
  haystack: CollationHaystack,
  cursor: number,
  settings: CollationSettings = DEFAULT_SETTINGS,
): ClauseMatch {
  if (needle.effectiveLength === 0 || haystack.points.length === 0) return emptyMatch()
  const exact = findExactHit(needle, haystack, cursor, settings.backSlack)
  if (exact) return exactMatch(haystack, exact, 'exact')
  if (needle.effectiveLength < settings.shortLength) {
    const gapHit = needle.gapCounts.strict + haystack.gapCounts.strict > 0
      ? findGapExactHit(needle, haystack, cursor, settings.backSlack)
      : null
    return gapHit ? exactMatch(haystack, gapHit, 'gap-exact') : emptyMatch()
  }
  const bounds = pieceBoundaries(needle, settings)
  let best = aggregatePieces(needle, haystack, windowPass(needle, bounds, haystack, cursor, settings), settings)
  if (best.ratio >= TEXT_VARIANT_RATIO) return best

  // 单调窗口内不理想：分别用首段与最长段全局锚定，再从锚点重跑窗口定位，取最优
  const anchors = [bounds[0]!]
  const longest = bounds.reduce((winner, piece) => (piece.end - piece.start > winner.end - winner.start ? piece : winner))
  if (longest !== bounds[0]) anchors.push(longest)
  for (const anchor of anchors) {
    const anchorCursor = globalAnchorCursor(needle, anchor, haystack, settings)
    if (anchorCursor === null || Math.abs(anchorCursor - cursor) <= settings.backSlack) continue
    const candidate = aggregatePieces(needle, haystack, windowPass(needle, bounds, haystack, anchorCursor, settings), settings)
    if (candidate.found && candidate.ratio > best.ratio) {
      best = { ...candidate, viaGlobal: true, strategy: candidate.strategy === 'window' ? 'global' : candidate.strategy }
    }
  }
  return best
}

/**
 * 命中后是否推进游标：短条文多处命中且远离窗口时不推进；全局回退得到的低相似度命中也不推进，避免误跳。
 */
export function shouldAdvanceCursor(
  needle: CollationNeedle,
  match: ClauseMatch,
  cursor: number,
  settings: CollationSettings = DEFAULT_SETTINGS,
): boolean {
  if (!match.found) return false
  if (match.exact && needle.effectiveLength < settings.shortLength && match.hitCount > 1) {
    return match.pointStart >= cursor - settings.backSlack && match.pointStart <= cursor + settings.forwardMin
  }
  if (match.viaGlobal && match.ratio < TEXT_VARIANT_RATIO) return false
  return true
}

export interface CollationInput {
  id: string
  text: string
}

export interface CollationOutcome {
  id: string
  needle: CollationNeedle
  match: ClauseMatch
}

/** 按条文顺序逐条定位，利用单调性：每条优先在上一条命中之后的窗口内搜索 */
export function collateWitness(
  inputs: readonly CollationInput[],
  haystack: CollationHaystack,
  settings: CollationSettings = DEFAULT_SETTINGS,
): CollationOutcome[] {
  const outcomes: CollationOutcome[] = []
  let cursor = 0
  for (const input of inputs) {
    const needle = prepareCollationNeedle(input.text, haystack.prepared.options)
    const match = locateClause(needle, haystack, cursor, settings)
    if (shouldAdvanceCursor(needle, match, cursor, settings)) cursor = match.pointEnd
    outcomes.push({ id: input.id, needle, match })
  }
  return outcomes
}

// ---------------------------------------------------------------------------
// 异文片段与记录
// ---------------------------------------------------------------------------

/** 条文 ↔ 见证本命中段的差异段（码点下标）；片段间见证本多出的文字记为 insert，未命中片段记为 delete */
export function clauseDiffRuns(needle: CollationNeedle, haystack: CollationHaystack, match: ClauseMatch): DiffRun[] {
  if (!match.found) return []
  if (match.exact) {
    return gapAwareDiff(needle.points, haystack.points.subarray(match.pointStart, match.pointEnd), 0, match.pointStart)
  }
  if (match.outOfOrder) return []
  const runs: DiffRun[] = []
  let witnessCursor = match.pointStart
  for (const piece of match.pieces) {
    if (piece.pointStart === null || piece.pointEnd === null) {
      runs.push({ op: 'delete', aStart: piece.needleStart, aEnd: piece.needleEnd, bStart: witnessCursor, bEnd: witnessCursor })
      continue
    }
    const pieceStart = Math.max(piece.pointStart, witnessCursor)
    if (pieceStart > witnessCursor) {
      runs.push({ op: 'insert', aStart: piece.needleStart, aEnd: piece.needleStart, bStart: witnessCursor, bEnd: pieceStart })
    }
    runs.push(
      ...gapAwareDiff(
        needle.points.subarray(piece.needleStart, piece.needleEnd),
        haystack.points.subarray(pieceStart, Math.max(pieceStart, piece.pointEnd)),
        piece.needleStart,
        pieceStart,
      ),
    )
    witnessCursor = Math.max(witnessCursor, piece.pointEnd)
  }
  return mergeRuns(runs)
}

function mergeRuns(runs: DiffRun[]): DiffRun[] {
  const merged: DiffRun[] = []
  for (const run of runs) {
    if (run.aEnd === run.aStart && run.bEnd === run.bStart) continue
    const last = merged[merged.length - 1]
    const isDiff = run.op !== 'equal'
    if (last && (last.op !== 'equal') === isDiff && last.aEnd === run.aStart && last.bEnd === run.bStart) {
      last.aEnd = run.aEnd
      last.bEnd = run.bEnd
      if (isDiff) {
        const lengthA = last.aEnd - last.aStart
        const lengthB = last.bEnd - last.bStart
        last.op = lengthA > 0 && lengthB > 0 ? 'replace' : lengthA > 0 ? 'delete' : 'insert'
      }
    } else {
      merged.push({ ...run })
    }
  }
  return merged
}

/**
 * 差异段 → 展示用 VariantSegment：local 取本项目原文、witness 取见证本原文（含标点）。
 * 两段之间的标点归入前一段，所有 local 拼接即完整条文，所有 witness 拼接即见证本命中段。
 */
export function buildVariantSegments(
  needle: CollationNeedle,
  haystack: CollationHaystack,
  match: ClauseMatch,
  runs: readonly DiffRun[],
): VariantSegment[] {
  if (!match.found || runs.length === 0) return []
  const localLength = needle.points.length
  const localBoundary = (point: number): number => {
    if (point <= 0) return 0
    if (point >= localLength) return needle.source.length
    return needle.normalized.offsetMap[needle.unitOfPoint[point]!]!
  }
  const witnessBoundary = (point: number): number => {
    if (point <= match.pointStart) return match.start
    if (point >= match.pointEnd) return match.end
    return haystack.prepared.normalized.offsetMap[haystack.unitOfPoint[point]!]!
  }
  const segments: VariantSegment[] = []
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]!
    const next = runs[index + 1]
    const localEnd = next ? next.aStart : localLength
    const witnessEnd = next ? next.bStart : match.pointEnd
    const local = run.aEnd > run.aStart ? needle.source.slice(localBoundary(run.aStart), localBoundary(localEnd)) : ''
    const witness =
      run.bEnd > run.bStart ? haystack.source.slice(witnessBoundary(run.bStart), witnessBoundary(witnessEnd)) : ''
    if (!local && !witness) continue
    const last = segments[segments.length - 1]
    if (last && last.op === run.op) {
      last.local += local
      last.witness += witness
    } else {
      segments.push({ op: run.op, local, witness })
    }
  }
  return segments
}

export interface ReplacePair {
  local: string
  witness: string
}

/** 等长短替换段逐字拆成字对（规范字；跳过通配），供补充异体字表 */
export function collectReplacePairs(
  needle: CollationNeedle,
  haystack: CollationHaystack,
  runs: readonly DiffRun[],
  maxLength = 2,
): ReplacePair[] {
  const pairs: ReplacePair[] = []
  for (const run of runs) {
    if (run.op !== 'replace') continue
    const localPoints = needle.points.subarray(run.aStart, run.aEnd).filter((point) => point !== OPTIONAL_GAP_CODE_POINT)
    const witnessPoints = haystack.points.subarray(run.bStart, run.bEnd).filter((point) => point !== OPTIONAL_GAP_CODE_POINT)
    if (localPoints.length !== witnessPoints.length || localPoints.length > maxLength) continue
    for (let index = 0; index < localPoints.length; index += 1) {
      const localPoint = localPoints[index]!
      const witnessPoint = witnessPoints[index]!
      if (localPoint === witnessPoint || isGapCodePoint(localPoint) || isGapCodePoint(witnessPoint)) continue
      pairs.push({ local: String.fromCodePoint(localPoint), witness: String.fromCodePoint(witnessPoint) })
    }
  }
  return pairs
}

/** 通配实际起作用的次数：差异段中 equal 段里与通配对齐的码点数（不含零代价删除的可选通配） */
export function countGapMatches(needle: CollationNeedle, haystack: CollationHaystack, runs: readonly DiffRun[]): number {
  let count = 0
  for (const run of runs) {
    if (run.op !== 'equal' || run.aEnd - run.aStart !== run.bEnd - run.bStart) continue
    for (let offset = 0; offset < run.aEnd - run.aStart; offset += 1) {
      const localPoint = needle.points[run.aStart + offset]!
      const witnessPoint = haystack.points[run.bStart + offset]!
      if (localPoint !== witnessPoint && (isGapCodePoint(localPoint) || isGapCodePoint(witnessPoint))) count += 1
    }
  }
  return count
}

export function roundRatio(ratio: number): number {
  const factor = 10 ** RATIO_DECIMALS
  return Math.round(ratio * factor) / factor
}

/** 相似度低于 MISSING_RATIO_FLOOR 为 missing，其余按 classifyTextMatch 分类 */
export function classifyCollationRatio(ratio: number): EvidenceVerdict {
  return ratio < MISSING_RATIO_FLOOR ? 'missing' : classifyTextMatch(ratio)
}

/** 未命中为 missing，否则按 classifyCollationRatio */
export function verdictOf(match: ClauseMatch): EvidenceVerdict {
  return match.found ? classifyCollationRatio(match.ratio) : 'missing'
}

/** 记录备注：多处命中、缺字通配改判、分段部分命中、全局回退、片段乱序、版本系统不同 */
export function collationNotes(
  needle: CollationNeedle,
  match: ClauseMatch,
  options: { differentRecension?: boolean; shortLength?: number } = {},
): string[] {
  const notes: string[] = []
  const shortLength = options.shortLength ?? SHORT_NEEDLE_LENGTH
  if (match.found && match.exact && match.hitCount > 1) {
    notes.push(`多处命中（${match.hitCount >= MAX_COUNTED_HITS ? `≥${MAX_COUNTED_HITS}` : match.hitCount} 处，取单调顺序最近处）`)
  }
  if (match.strategy === 'gap-exact') notes.push('缺字通配后精确命中')
  if (match.found && match.ratio < MISSING_RATIO_FLOOR) {
    notes.push(`最佳候选相似度 ${roundRatio(match.ratio)} 低于 ${MISSING_RATIO_FLOOR}，按 missing 处理（locator 指向该候选）`)
  }
  if (match.found && match.ratio >= MISSING_RATIO_FLOOR && match.plainRatio < match.ratio) {
    const plainVerdict = classifyCollationRatio(match.plainRatio)
    const verdict = classifyCollationRatio(match.ratio)
    notes.push(
      plainVerdict === verdict
        ? '含缺字，已按通配比对'
        : `含缺字，按通配比对由 ${plainVerdict} 改判为 ${verdict}`,
    )
  }
  if (match.found && match.pieces.length > 1 && match.matchedPieces < match.pieces.length) {
    notes.push(`分段部分命中 ${match.matchedPieces}/${match.pieces.length}`)
  }
  if (match.found && match.structuralGaps > 0) {
    notes.push(`见证本在句间多出 ${match.structuralGaps} 段文字（共 ${match.structuralChars} 字，疑为方药/校注/注文，未计入 ratio）`)
  }
  if (match.found && match.viaGlobal) notes.push('单调窗口外命中（全局回退）')
  if (match.outOfOrder) notes.push('分段命中顺序与条文不一致')
  if (!match.found && needle.effectiveLength > 0 && needle.effectiveLength < shortLength) notes.push('短条文仅做精确定位')
  if (!match.found && needle.effectiveLength === 0) notes.push('条文规范化后为空')
  if (options.differentRecension) notes.push('见证本属不同版本系统，异文属预期')
  return notes
}

export interface RecordInput {
  entityId: string
  needle: CollationNeedle
  match: ClauseMatch
  evidence: Evidence
  variants?: VariantSegment[]
  differentRecension?: boolean
}

/** 生成 field=text 的条文证据记录；variants 仅在 verdict=variant 时写入 */
export function buildCollationRecord(input: RecordInput): EntityEvidenceRecord {
  const verdict = verdictOf(input.match)
  const record: EntityEvidenceRecord = {
    entityId: input.entityId,
    entityType: 'clause',
    field: 'text',
    verdict,
    evidence: input.evidence,
  }
  if (verdict !== 'missing') record.ratio = roundRatio(input.match.ratio)
  if (verdict === 'variant' && input.variants && input.variants.length > 0) record.variants = input.variants
  const notes = collationNotes(input.needle, input.match, { differentRecension: input.differentRecension })
  if (notes.length > 0) record.note = notes.join('；')
  return record
}

// ---------------------------------------------------------------------------
// 汇总统计
// ---------------------------------------------------------------------------

export interface VerdictTally {
  total: number
  agree: number
  variant: number
  mismatch: number
  missing: number
  rates: Record<EvidenceVerdict, number>
  /** 非 missing 记录的平均 ratio；无则 null */
  averageRatio: number | null
}

const VERDICTS: readonly EvidenceVerdict[] = ['agree', 'variant', 'mismatch', 'missing']

export function tallyVerdicts(records: ReadonlyArray<Pick<EntityEvidenceRecord, 'verdict' | 'ratio'>>): VerdictTally {
  const counts: Record<EvidenceVerdict, number> = { agree: 0, variant: 0, mismatch: 0, missing: 0 }
  let ratioSum = 0
  let ratioCount = 0
  for (const record of records) {
    if (!VERDICTS.includes(record.verdict)) throw new Error(`tallyVerdicts：未知 verdict「${String(record.verdict)}」`)
    counts[record.verdict] += 1
    if (record.verdict !== 'missing' && typeof record.ratio === 'number') {
      ratioSum += record.ratio
      ratioCount += 1
    }
  }
  const total = records.length
  const rate = (count: number) => (total === 0 ? 0 : roundRatio(count / total))
  return {
    total,
    ...counts,
    rates: { agree: rate(counts.agree), variant: rate(counts.variant), mismatch: rate(counts.mismatch), missing: rate(counts.missing) },
    averageRatio: ratioCount === 0 ? null : roundRatio(ratioSum / ratioCount),
  }
}

export interface RankedPair extends ReplacePair {
  count: number
  books: string[]
  example: string
}

/** 字对按出现次数降序、字典序升序排列（稳定、可重复） */
export function rankReplacePairs(
  entries: ReadonlyArray<ReplacePair & { bookId: string; entityId: string }>,
  limit: number,
): RankedPair[] {
  const singles = entries.map((entry) => ({
    local: entry.local,
    witness: entry.witness,
    count: 1,
    books: [entry.bookId],
    example: entry.entityId,
  }))
  return mergeRankedPairs([singles], limit)
}

/** 与区域设置无关的码元序比较，保证排序可重复 */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** 合并多份已排名字对（如各书各见证），次数相加后重新排名 */
export function mergeRankedPairs(lists: ReadonlyArray<readonly RankedPair[]>, limit: number): RankedPair[] {
  const grouped = new Map<string, { local: string; witness: string; count: number; books: Set<string>; example: string }>()
  for (const list of lists) {
    for (const pair of list) {
      const key = `${pair.local}\u0000${pair.witness}`
      let group = grouped.get(key)
      if (!group) {
        group = { local: pair.local, witness: pair.witness, count: 0, books: new Set(), example: pair.example }
        grouped.set(key, group)
      }
      group.count += pair.count
      for (const book of pair.books) group.books.add(book)
      if (pair.example < group.example) group.example = pair.example
    }
  }
  return [...grouped.values()]
    .sort(
      (left, right) =>
        right.count - left.count || compareCodeUnits(left.local, right.local) || compareCodeUnits(left.witness, right.witness),
    )
    .slice(0, limit)
    .map((group) => ({
      local: group.local,
      witness: group.witness,
      count: group.count,
      books: [...group.books].sort(),
      example: group.example,
    }))
}

export interface ChapterHotspot {
  chapter: string
  total: number
  anomalies: number
  rate: number
}

/** 按篇章统计 mismatch+missing，返回比例 ≥ minRate 且条数 ≥ minCount 的篇章（按异常数降序） */
export function chapterHotspots(
  items: ReadonlyArray<{ chapter: string; verdict: EvidenceVerdict }>,
  options: { minRate?: number; minCount?: number; limit?: number } = {},
): ChapterHotspot[] {
  const minRate = options.minRate ?? 0.8
  const minCount = options.minCount ?? 3
  const limit = options.limit ?? 5
  const byChapter = new Map<string, { total: number; anomalies: number; order: number }>()
  items.forEach((item, order) => {
    const entry = byChapter.get(item.chapter) ?? { total: 0, anomalies: 0, order }
    entry.total += 1
    if (item.verdict === 'mismatch' || item.verdict === 'missing') entry.anomalies += 1
    byChapter.set(item.chapter, entry)
  })
  return [...byChapter.entries()]
    .map(([chapter, entry]) => ({ chapter, total: entry.total, anomalies: entry.anomalies, rate: roundRatio(entry.anomalies / entry.total), order: entry.order }))
    .filter((entry) => entry.anomalies >= minCount && entry.rate >= minRate)
    .sort((left, right) => right.anomalies - left.anomalies || left.order - right.order)
    .slice(0, limit)
    .map(({ chapter, total, anomalies, rate }) => ({ chapter, total, anomalies, rate }))
}

/** 从 items 中等距抽取至多 count 个（确定性） */
export function evenlySample<T>(items: readonly T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return []
  if (items.length <= count) return [...items]
  const picked: T[] = []
  for (let index = 0; index < count; index += 1) {
    picked.push(items[Math.floor((index * items.length) / count)]!)
  }
  return picked
}

/** 显示用规范串（通配显示为 □，可选通配省略） */
export function displayPoints(points: Int32Array): string {
  return pointsToString(points, true)
}
