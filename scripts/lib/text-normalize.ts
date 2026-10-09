import { readFileSync } from 'node:fs'
import path from 'node:path'
import { toSimplifiedChinese } from './wiki.ts'

/**
 * 校勘比对用文本规范化、相似度、定位与差异工具。
 * 只产出“比对串”，绝不改动展示文本；需要回到原文时用 offsetMap 映射。
 */

/** 相似度 ≥ 此值视为同文 */
export const TEXT_AGREE_RATIO = 0.95
/** 相似度 ≥ 此值视为同段异文 */
export const TEXT_VARIANT_RATIO = 0.8
/** 浮点比较容差，避免 1 - d/n 的舍入误差让恰好落在阈值上的比率被误判 */
const RATIO_EPSILON = 1e-9

/** 精确编辑距离允许的最大 DP 单元数（约 2000×2000），超出改用分块近似 */
export const MAX_EXACT_DISTANCE_CELLS = 4_000_000
/** 分块近似时每块的最大长度（码点） */
export const DISTANCE_CHUNK_LENGTH = 1_000
/** diffSegments 回溯矩阵允许的最大单元数，超出改用分块 */
export const MAX_DIFF_CELLS = 1_000_000
/** diffSegments 分块长度（码点） */
export const DIFF_CHUNK_LENGTH = 1_000

/** 模糊定位用 n-gram 长度（UTF-16 码元） */
export const NGRAM_SIZE = 4
/** 单次模糊定位最多处理的倒排命中数，优先使用低频 gram */
export const MAX_VOTE_POSTINGS = 50_000
/** 对角线投票分桶宽度，容忍少量增删造成的偏移 */
const DIAGONAL_BUCKET_SIZE = 16
/** 默认最多验证的候选窗口数 */
export const DEFAULT_MAX_LOCATE_CANDIDATES = 8
/** 候选窗口两侧的最小冗余长度 */
const MIN_WINDOW_SLACK = 8
/** 候选窗口两侧冗余占引文长度的比例（与 0.8 阈值对应的增删上限） */
const WINDOW_SLACK_RATIO = 0.25
const MIN_NGRAM_TABLE_BITS = 10
const MAX_NGRAM_TABLE_BITS = 22

if (DISTANCE_CHUNK_LENGTH * DISTANCE_CHUNK_LENGTH > MAX_EXACT_DISTANCE_CELLS) {
  throw new Error('text-normalize：DISTANCE_CHUNK_LENGTH² 必须不超过 MAX_EXACT_DISTANCE_CELLS')
}
if (DIFF_CHUNK_LENGTH * DIFF_CHUNK_LENGTH > MAX_DIFF_CELLS) {
  throw new Error('text-normalize：DIFF_CHUNK_LENGTH² 必须不超过 MAX_DIFF_CELLS')
}

export type TextMatchClass = 'agree' | 'variant' | 'mismatch'

export interface NormalizeOptions {
  /** 去除 (...) / （...） 内的小字注，默认 false */
  stripNotes?: boolean
  /** 把“症”并入“证”（古籍中二字有区分），默认 false */
  mergeZhengZheng?: boolean
}

export interface NormalizedText {
  /** 规范串 */
  text: string
  /** offsetMap[i]：规范串第 i 个 UTF-16 码元对应原文字符的起始下标 */
  offsetMap: Int32Array
  /** offsetEndMap[i]：规范串第 i 个 UTF-16 码元对应原文字符的结束下标（不含） */
  offsetEndMap: Int32Array
}

export interface PreparedHaystack {
  readonly source: string
  readonly normalized: NormalizedText
  readonly options: Readonly<Required<NormalizeOptions>>
}

export interface LocateOptions extends NormalizeOptions {
  /** 模糊命中的最低相似度，默认 TEXT_VARIANT_RATIO */
  minRatio?: number
  /** 最多验证的候选窗口数，默认 DEFAULT_MAX_LOCATE_CANDIDATES */
  maxCandidates?: number
}

export interface LocateResult {
  /** 原文 haystack 起始下标 */
  start: number
  /** 原文 haystack 结束下标（不含） */
  end: number
  ratio: number
  exact: boolean
}

export type DiffOp = 'equal' | 'insert' | 'delete' | 'replace'

export interface DiffSegment {
  op: DiffOp
  a: string
  b: string
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`text-normalize：${label} 必须是字符串`)
  }
}

// ---------------------------------------------------------------------------
// 异体字表
// ---------------------------------------------------------------------------

const VARIANT_TABLE_PATH = path.resolve(import.meta.dirname, '../../data/ontology/variant-chars.json')
const VARIANT_KINDS = new Set(['异体', '古今字', '通假'])

interface VariantPair {
  from: string
  to: string
}

interface VariantEntry extends VariantPair {
  kind: string
  note?: string
}

interface VariantTableFile {
  variants: VariantEntry[]
  optional?: { mergeZhengZheng?: { pairs?: VariantPair[] } }
}

interface VariantMaps {
  base: Map<number, number>
  withZhengZheng: Map<number, number>
}

let cachedVariantMaps: VariantMaps | null = null

function singleCodePoint(value: unknown, label: string): number {
  if (typeof value !== 'string') throw new Error(`variant-chars.json：${label} 必须是字符串`)
  const chars = Array.from(value)
  if (chars.length !== 1) {
    throw new Error(`variant-chars.json：${label} 必须是单个字符，实际为「${value}」`)
  }
  return chars[0]!.codePointAt(0)!
}

/** 构建码点映射，展开链式映射（a→b→c 记为 a→c）并拒绝重复键与环 */
function buildVariantMap(pairs: VariantPair[]): Map<number, number> {
  const direct = new Map<number, number>()
  for (const pair of pairs) {
    const from = singleCodePoint(pair.from, `from「${String(pair.from)}」`)
    const to = singleCodePoint(pair.to, `to（from=${pair.from}）`)
    if (from === to) throw new Error(`variant-chars.json：「${pair.from}」映射到自身`)
    if (direct.has(from)) throw new Error(`variant-chars.json：「${pair.from}」重复定义`)
    direct.set(from, to)
  }
  const resolved = new Map<number, number>()
  for (const [from, firstTarget] of direct) {
    const visited = new Set<number>([from])
    let target = firstTarget
    while (direct.has(target)) {
      if (visited.has(target)) {
        throw new Error(`variant-chars.json：「${String.fromCodePoint(from)}」存在循环映射`)
      }
      visited.add(target)
      target = direct.get(target)!
    }
    resolved.set(from, target)
  }
  return resolved
}

function loadVariantMaps(): VariantMaps {
  if (cachedVariantMaps) return cachedVariantMaps
  let parsed: VariantTableFile
  try {
    parsed = JSON.parse(readFileSync(VARIANT_TABLE_PATH, 'utf8')) as VariantTableFile
  } catch (error) {
    throw new Error(`读取异体字表失败（${VARIANT_TABLE_PATH}）：${(error as Error).message}`)
  }
  if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) {
    throw new Error('variant-chars.json：variants 必须是非空数组')
  }
  for (const entry of parsed.variants) {
    if (!VARIANT_KINDS.has(entry.kind)) {
      throw new Error(`variant-chars.json：「${entry.from}」的 kind「${entry.kind}」不在 ${[...VARIANT_KINDS].join('/')} 中`)
    }
  }
  const zhengZhengPairs = parsed.optional?.mergeZhengZheng?.pairs ?? []
  cachedVariantMaps = {
    base: buildVariantMap(parsed.variants),
    withZhengZheng: buildVariantMap([...parsed.variants, ...zhengZhengPairs]),
  }
  return cachedVariantMaps
}

function variantMapFor(options: NormalizeOptions): Map<number, number> {
  const maps = loadVariantMaps()
  return options.mergeZhengZheng ? maps.withZhengZheng : maps.base
}

// ---------------------------------------------------------------------------
// 单项变换
// ---------------------------------------------------------------------------

/** 繁→简：复用 wiki.ts 的 opencc 转换器（tw→cn，模块级单例），与管线已解析数据保持一致 */
export function toSimplified(text: string): string {
  assertString(text, 'text')
  return toSimplifiedChinese(text)
}

/** 按 variant-chars.json 把异体字/古今字统一到比对用规范字；不处理标点与繁简 */
export function normalizeVariants(text: string, options: Pick<NormalizeOptions, 'mergeZhengZheng'> = {}): string {
  assertString(text, 'text')
  const variantMap = variantMapFor(options)
  const parts: string[] = []
  let changed = false
  for (const char of text) {
    const target = variantMap.get(char.codePointAt(0)!)
    if (target === undefined) {
      parts.push(char)
    } else {
      parts.push(String.fromCodePoint(target))
      changed = true
    }
  }
  return changed ? parts.join('') : text
}

/** 去掉标点、空白、¶、<pb:…> 页码标记，可选去掉括注；不做繁简与异体转换 */
export function stripForCompare(text: string, options: Pick<NormalizeOptions, 'stripNotes'> = {}): string {
  assertString(text, 'text')
  return normalizeCore(text, { simplify: false, variantMap: null, stripNotes: options.stripNotes ?? false }, false).text
}

/** 组合繁→简、异体归一、剥离标点；withOffsets 为 true 时同时返回规范串 → 原文的下标映射 */
export function normalizeForCompare(text: string, options: NormalizeOptions & { withOffsets: true }): NormalizedText
export function normalizeForCompare(text: string, options?: NormalizeOptions & { withOffsets?: false }): string
export function normalizeForCompare(
  text: string,
  options: NormalizeOptions & { withOffsets?: boolean } = {},
): string | NormalizedText {
  assertString(text, 'text')
  const trackOffsets = options.withOffsets === true
  const result = normalizeCore(
    text,
    { simplify: true, variantMap: variantMapFor(options), stripNotes: options.stripNotes ?? false },
    trackOffsets,
  )
  return trackOffsets ? result : result.text
}

/** 把规范串区间 [start, end) 映射回原文区间 */
export function mapNormalizedRange(
  normalized: NormalizedText,
  start: number,
  end: number,
): { start: number; end: number } {
  const length = normalized.text.length
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > length || start >= end) {
    throw new RangeError(`mapNormalizedRange：区间 [${start}, ${end}) 不在 [0, ${length}] 内或为空`)
  }
  if (normalized.offsetMap.length !== length || normalized.offsetEndMap.length !== length) {
    throw new Error('mapNormalizedRange：缺少 offsetMap，请用 withOffsets: true 生成')
  }
  return { start: normalized.offsetMap[start]!, end: normalized.offsetEndMap[end - 1]! }
}

// ---------------------------------------------------------------------------
// 规范化核心
// ---------------------------------------------------------------------------

interface CoreStages {
  /** 繁→简，并对兼容汉字/全角字符做 NFKC 折叠 */
  simplify: boolean
  variantMap: Map<number, number> | null
  stripNotes: boolean
}

const PAGE_BREAK_RE = /<pb:[^>]*>/g
const COMPARABLE_CHAR_RE = /^[\p{L}\p{N}\p{Co}]$/u
const singleCharSimplifiedCache = new Map<string, string>()

function simplifySingle(char: string): string {
  let converted = singleCharSimplifiedCache.get(char)
  if (converted === undefined) {
    converted = toSimplifiedChinese(char)
    singleCharSimplifiedCache.set(char, converted)
  }
  return converted
}

/** 兼容汉字、康熙部首、全角/半角形式需先 NFKC 才能与统一汉字比对 */
function needsCompatFold(codePoint: number): boolean {
  return (
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x2f800 && codePoint <= 0x2fa1f) ||
    (codePoint >= 0x2f00 && codePoint <= 0x2fdf) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef)
  )
}

/** 只保留文字、数字与私用区字符（Kanripo 未编码字），其余标点、符号、空白、变体选择符全部去掉 */
function isComparable(codePoint: number, char: string): boolean {
  if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return true
  if (codePoint < 0x80) {
    const lower = codePoint | 0x20
    return (codePoint >= 0x30 && codePoint <= 0x39) || (lower >= 0x61 && lower <= 0x7a)
  }
  return COMPARABLE_CHAR_RE.test(char)
}

/** 标记需整体剔除的原文区间：<pb:…> 页码、可选的括注（支持嵌套，未闭合的左括号按普通字符处理） */
function buildRemovalMask(text: string, stripNotes: boolean): Uint8Array | null {
  let mask: Uint8Array | null = null
  for (const match of text.matchAll(PAGE_BREAK_RE)) {
    mask ??= new Uint8Array(text.length)
    mask.fill(1, match.index, match.index + match[0].length)
  }
  if (stripNotes) {
    const openStack: number[] = []
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index)
      if (code === 0x28 || code === 0xff08) {
        openStack.push(index)
      } else if ((code === 0x29 || code === 0xff09) && openStack.length > 0) {
        const openIndex = openStack.pop()!
        mask ??= new Uint8Array(text.length)
        mask.fill(1, openIndex, index + 1)
      }
    }
  }
  return mask
}

function normalizeCore(text: string, stages: CoreStages, trackOffsets: boolean): NormalizedText {
  const length = text.length
  const removalMask = buildRemovalMask(text, stages.stripNotes)
  const converted = stages.simplify ? toSimplifiedChinese(text) : text
  // opencc 词组转换实际是逐字等长替换；若长度不一致则退回逐字转换以保证下标可映射
  const aligned = converted.length === length
  const parts: string[] = []
  const starts: number[] = []
  const ends: number[] = []

  let index = 0
  while (index < length) {
    const sourceCodePoint = text.codePointAt(index)!
    const sourceEnd = index + (sourceCodePoint > 0xffff ? 2 : 1)
    if (removalMask === null || removalMask[index] === 0) {
      const sourceChar = text.slice(index, sourceEnd)
      const chunk = !stages.simplify
        ? sourceChar
        : aligned
          ? converted.slice(index, sourceEnd)
          : simplifySingle(sourceChar)
      for (const chunkChar of chunk) {
        let candidates = chunkChar
        const chunkCodePoint = chunkChar.codePointAt(0)!
        if (stages.simplify && needsCompatFold(chunkCodePoint)) {
          candidates = chunkChar.normalize('NFKC')
          if (candidates !== chunkChar) candidates = simplifySingle(candidates)
        }
        for (const candidate of candidates) {
          let codePoint = candidate.codePointAt(0)!
          let outputChar = candidate
          const variantTarget = stages.variantMap?.get(codePoint)
          if (variantTarget !== undefined) {
            codePoint = variantTarget
            outputChar = String.fromCodePoint(variantTarget)
          }
          if (!isComparable(codePoint, outputChar)) continue
          parts.push(outputChar)
          if (trackOffsets) {
            for (let unit = 0; unit < outputChar.length; unit += 1) {
              starts.push(index)
              ends.push(sourceEnd)
            }
          }
        }
      }
    }
    index = sourceEnd
  }

  return {
    text: parts.join(''),
    offsetMap: Int32Array.from(starts),
    offsetEndMap: Int32Array.from(ends),
  }
}

// ---------------------------------------------------------------------------
// 编辑距离与相似度
// ---------------------------------------------------------------------------

interface DecodedText {
  points: Int32Array
  /** unitOffsets[k]：第 k 个码点在原串中的 UTF-16 下标，末尾多一项为串长 */
  unitOffsets: Int32Array
}

function decodeCodePoints(text: string): DecodedText {
  const points = new Int32Array(text.length)
  const unitOffsets = new Int32Array(text.length + 1)
  let count = 0
  let index = 0
  while (index < text.length) {
    const codePoint = text.codePointAt(index)!
    points[count] = codePoint
    unitOffsets[count] = index
    count += 1
    index += codePoint > 0xffff ? 2 : 1
  }
  unitOffsets[count] = text.length
  return { points: points.subarray(0, count), unitOffsets: unitOffsets.subarray(0, count + 1) }
}

function levenshteinCore(first: Int32Array, second: Int32Array): number {
  const [longer, shorter] = first.length >= second.length ? [first, second] : [second, first]
  const width = shorter.length
  let previous = new Int32Array(width + 1)
  let current = new Int32Array(width + 1)
  for (let column = 0; column <= width; column += 1) previous[column] = column
  for (let row = 1; row <= longer.length; row += 1) {
    current[0] = row
    const rowChar = longer[row - 1]
    for (let column = 1; column <= width; column += 1) {
      const substitute = previous[column - 1]! + (rowChar === shorter[column - 1] ? 0 : 1)
      const remove = previous[column]! + 1
      const insert = current[column - 1]! + 1
      current[column] = substitute < remove ? (substitute < insert ? substitute : insert) : remove < insert ? remove : insert
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[width]!
}

/** 先去公共前后缀；剩余规模超过 MAX_EXACT_DISTANCE_CELLS 时按比例分块求和（结果为真实距离的上界） */
function levenshteinPoints(first: Int32Array, second: Int32Array): number {
  let prefix = 0
  const minLength = Math.min(first.length, second.length)
  while (prefix < minLength && first[prefix] === second[prefix]) prefix += 1
  let firstEnd = first.length
  let secondEnd = second.length
  while (firstEnd > prefix && secondEnd > prefix && first[firstEnd - 1] === second[secondEnd - 1]) {
    firstEnd -= 1
    secondEnd -= 1
  }
  const firstMiddle = first.subarray(prefix, firstEnd)
  const secondMiddle = second.subarray(prefix, secondEnd)
  if (firstMiddle.length === 0) return secondMiddle.length
  if (secondMiddle.length === 0) return firstMiddle.length
  if (firstMiddle.length * secondMiddle.length <= MAX_EXACT_DISTANCE_CELLS) {
    return levenshteinCore(firstMiddle, secondMiddle)
  }
  const chunkCount = Math.ceil(Math.max(firstMiddle.length, secondMiddle.length) / DISTANCE_CHUNK_LENGTH)
  let total = 0
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const firstStart = Math.floor((firstMiddle.length * chunk) / chunkCount)
    const firstStop = Math.floor((firstMiddle.length * (chunk + 1)) / chunkCount)
    const secondStart = Math.floor((secondMiddle.length * chunk) / chunkCount)
    const secondStop = Math.floor((secondMiddle.length * (chunk + 1)) / chunkCount)
    total += levenshteinPoints(
      firstMiddle.subarray(firstStart, firstStop),
      secondMiddle.subarray(secondStart, secondStop),
    )
  }
  return total
}

/** 按码点计算 Levenshtein 编辑距离（替换/插入/删除代价均为 1） */
export function editDistance(a: string, b: string): number {
  assertString(a, 'a')
  assertString(b, 'b')
  if (a === b) return 0
  return levenshteinPoints(decodeCodePoints(a).points, decodeCodePoints(b).points)
}

/**
 * 相似度 = 1 - 编辑距离 / max(码点长度)，取值 0..1；两串均为空时视为相同返回 1。
 * 时间 O(n·m)、空间 O(min(n, m))；500×500 约 25 万次运算。
 * 去掉公共前后缀后规模仍超过 MAX_EXACT_DISTANCE_CELLS 时分块近似，此时结果是真实相似度的下界。
 * 调用方应先用 normalizeForCompare 规范两侧文本。
 */
export function similarity(a: string, b: string): number {
  assertString(a, 'a')
  assertString(b, 'b')
  if (a === b) return 1
  const firstPoints = decodeCodePoints(a).points
  const secondPoints = decodeCodePoints(b).points
  const longest = Math.max(firstPoints.length, secondPoints.length)
  if (longest === 0) return 1
  return 1 - levenshteinPoints(firstPoints, secondPoints) / longest
}

/** ≥ TEXT_AGREE_RATIO 为 agree，≥ TEXT_VARIANT_RATIO 为 variant，其余 mismatch */
export function classifyTextMatch(ratio: number): TextMatchClass {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new RangeError(`classifyTextMatch：ratio 必须在 0..1 之间，实际为 ${ratio}`)
  }
  if (ratio + RATIO_EPSILON >= TEXT_AGREE_RATIO) return 'agree'
  if (ratio + RATIO_EPSILON >= TEXT_VARIANT_RATIO) return 'variant'
  return 'mismatch'
}

// ---------------------------------------------------------------------------
// 逐字差异
// ---------------------------------------------------------------------------

class SegmentBuilder {
  readonly segments: DiffSegment[] = []
  private runKind: 'equal' | 'diff' | null = null
  private runStartA = 0
  private runStartB = 0
  private positionA = 0
  private positionB = 0
  private readonly textA: string
  private readonly offsetsA: Int32Array
  private readonly textB: string
  private readonly offsetsB: Int32Array

  constructor(textA: string, offsetsA: Int32Array, textB: string, offsetsB: Int32Array) {
    this.textA = textA
    this.offsetsA = offsetsA
    this.textB = textB
    this.offsetsB = offsetsB
  }

  advance(kind: 'equal' | 'diff', countA: number, countB: number): void {
    if (countA === 0 && countB === 0) return
    if (this.runKind !== kind) {
      this.flush()
      this.runKind = kind
      this.runStartA = this.positionA
      this.runStartB = this.positionB
    }
    this.positionA += countA
    this.positionB += countB
  }

  flush(): void {
    if (this.runKind === null) return
    const partA = this.textA.slice(this.offsetsA[this.runStartA], this.offsetsA[this.positionA])
    const partB = this.textB.slice(this.offsetsB[this.runStartB], this.offsetsB[this.positionB])
    if (partA || partB) {
      const op: DiffOp =
        this.runKind === 'equal' ? 'equal' : partA && partB ? 'replace' : partA ? 'delete' : 'insert'
      this.segments.push({ op, a: partA, b: partB })
    }
    this.runKind = null
  }
}

const DIFF_STEP_EQUAL = 0
const DIFF_STEP_SUBSTITUTE = 1
const DIFF_STEP_DELETE = 2
const DIFF_STEP_INSERT = 3

function diffMatrix(
  first: Int32Array,
  second: Int32Array,
  builder: SegmentBuilder,
): void {
  const rows = first.length
  const columns = second.length
  const stride = columns + 1
  const table = new Int32Array((rows + 1) * stride)
  for (let column = 0; column <= columns; column += 1) table[column] = column
  for (let row = 1; row <= rows; row += 1) {
    const rowBase = row * stride
    const previousBase = rowBase - stride
    table[rowBase] = row
    const rowChar = first[row - 1]
    for (let column = 1; column <= columns; column += 1) {
      const substitute = table[previousBase + column - 1]! + (rowChar === second[column - 1] ? 0 : 1)
      const remove = table[previousBase + column]! + 1
      const insert = table[rowBase + column - 1]! + 1
      table[rowBase + column] =
        substitute < remove ? (substitute < insert ? substitute : insert) : remove < insert ? remove : insert
    }
  }

  const steps = new Uint8Array(rows + columns)
  let stepCount = 0
  let row = rows
  let column = columns
  while (row > 0 || column > 0) {
    const value = table[row * stride + column]!
    if (row > 0 && column > 0) {
      const diagonal = table[(row - 1) * stride + column - 1]!
      if (first[row - 1] === second[column - 1] && value === diagonal) {
        steps[stepCount++] = DIFF_STEP_EQUAL
        row -= 1
        column -= 1
        continue
      }
      if (value === diagonal + 1) {
        steps[stepCount++] = DIFF_STEP_SUBSTITUTE
        row -= 1
        column -= 1
        continue
      }
    }
    if (row > 0 && value === table[(row - 1) * stride + column]! + 1) {
      steps[stepCount++] = DIFF_STEP_DELETE
      row -= 1
    } else {
      steps[stepCount++] = DIFF_STEP_INSERT
      column -= 1
    }
  }

  for (let step = stepCount - 1; step >= 0; step -= 1) {
    switch (steps[step]) {
      case DIFF_STEP_EQUAL:
        builder.advance('equal', 1, 1)
        break
      case DIFF_STEP_SUBSTITUTE:
        builder.advance('diff', 1, 1)
        break
      case DIFF_STEP_DELETE:
        builder.advance('diff', 1, 0)
        break
      default:
        builder.advance('diff', 0, 1)
    }
  }
}

function diffRange(
  first: Int32Array,
  second: Int32Array,
  builder: SegmentBuilder,
): void {
  let prefix = 0
  const minLength = Math.min(first.length, second.length)
  while (prefix < minLength && first[prefix] === second[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < minLength - prefix &&
    first[first.length - 1 - suffix] === second[second.length - 1 - suffix]
  ) {
    suffix += 1
  }
  builder.advance('equal', prefix, prefix)
  const firstMiddle = first.subarray(prefix, first.length - suffix)
  const secondMiddle = second.subarray(prefix, second.length - suffix)
  if (firstMiddle.length === 0 || secondMiddle.length === 0) {
    builder.advance('diff', firstMiddle.length, secondMiddle.length)
  } else if (firstMiddle.length * secondMiddle.length <= MAX_DIFF_CELLS) {
    diffMatrix(firstMiddle, secondMiddle, builder)
  } else {
    const chunkCount = Math.ceil(Math.max(firstMiddle.length, secondMiddle.length) / DIFF_CHUNK_LENGTH)
    for (let chunk = 0; chunk < chunkCount; chunk += 1) {
      diffRange(
        firstMiddle.subarray(
          Math.floor((firstMiddle.length * chunk) / chunkCount),
          Math.floor((firstMiddle.length * (chunk + 1)) / chunkCount),
        ),
        secondMiddle.subarray(
          Math.floor((secondMiddle.length * chunk) / chunkCount),
          Math.floor((secondMiddle.length * (chunk + 1)) / chunkCount),
        ),
        builder,
      )
    }
  }
  builder.advance('equal', suffix, suffix)
}

/**
 * 逐字（码点）差异片段，基于与 similarity 相同的编辑距离对齐；相邻的非相等操作合并为一段。
 * insert 表示 b 多出的文字，delete 表示 a 多出的文字。超长输入分块对齐，结果仍可拼回原串但未必最优。
 */
export function diffSegments(a: string, b: string): DiffSegment[] {
  assertString(a, 'a')
  assertString(b, 'b')
  const decodedA = decodeCodePoints(a)
  const decodedB = decodeCodePoints(b)
  const builder = new SegmentBuilder(a, decodedA.unitOffsets, b, decodedB.unitOffsets)
  diffRange(decodedA.points, decodedB.points, builder)
  builder.flush()
  return builder.segments
}

// ---------------------------------------------------------------------------
// 长文定位
// ---------------------------------------------------------------------------

interface NgramIndex {
  mask: number
  /** 桶 h 的命中位置为 positions[bucketStarts[h] .. bucketStarts[h + 1]) */
  bucketStarts: Int32Array
  positions: Int32Array
}

const ngramIndexCache = new WeakMap<PreparedHaystack, NgramIndex>()

function gramHash(text: string, position: number): number {
  let hash = 0x811c9dc5
  for (let offset = 0; offset < NGRAM_SIZE; offset += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(position + offset), 0x01000193)
  }
  return hash >>> 0
}

function gramEquals(haystack: string, haystackPosition: number, needle: string, needlePosition: number): boolean {
  for (let offset = 0; offset < NGRAM_SIZE; offset += 1) {
    if (haystack.charCodeAt(haystackPosition + offset) !== needle.charCodeAt(needlePosition + offset)) return false
  }
  return true
}

function buildNgramIndex(text: string): NgramIndex {
  const gramCount = Math.max(0, text.length - NGRAM_SIZE + 1)
  let bits = MIN_NGRAM_TABLE_BITS
  while (1 << bits < gramCount && bits < MAX_NGRAM_TABLE_BITS) bits += 1
  const mask = (1 << bits) - 1
  const hashes = new Int32Array(gramCount)
  const bucketStarts = new Int32Array(mask + 2)
  for (let position = 0; position < gramCount; position += 1) {
    const bucket = gramHash(text, position) & mask
    hashes[position] = bucket
    bucketStarts[bucket + 1] = bucketStarts[bucket + 1]! + 1
  }
  for (let bucket = 1; bucket < bucketStarts.length; bucket += 1) {
    bucketStarts[bucket] = bucketStarts[bucket]! + bucketStarts[bucket - 1]!
  }
  const cursor = bucketStarts.slice(0, mask + 1)
  const positions = new Int32Array(gramCount)
  for (let position = 0; position < gramCount; position += 1) {
    const bucket = hashes[position]!
    const slot = cursor[bucket]!
    positions[slot] = position
    cursor[bucket] = slot + 1
  }
  return { mask, bucketStarts, positions }
}

function ngramIndexFor(prepared: PreparedHaystack): NgramIndex {
  let index = ngramIndexCache.get(prepared)
  if (!index) {
    index = buildNgramIndex(prepared.normalized.text)
    ngramIndexCache.set(prepared, index)
  }
  return index
}

/** 预处理长文本（整卷），供多次 locateInText 复用；n-gram 倒排索引在首次模糊查找时惰性构建 */
export function prepareHaystack(haystack: string, options: NormalizeOptions = {}): PreparedHaystack {
  assertString(haystack, 'haystack')
  const resolvedOptions = {
    stripNotes: options.stripNotes ?? false,
    mergeZhengZheng: options.mergeZhengZheng ?? false,
  }
  return {
    source: haystack,
    normalized: normalizeForCompare(haystack, { ...resolvedOptions, withOffsets: true }),
    options: resolvedOptions,
  }
}

interface AlignmentHit {
  cost: number
  /** 窗口内码点下标 */
  start: number
  end: number
}

/** 半全局对齐：引文须完整参与，窗口两端可自由截取；O(m·w) */
function semiGlobalAlign(needle: Int32Array, window: Int32Array): AlignmentHit {
  const needleLength = needle.length
  let previousCost = new Int32Array(needleLength + 1)
  let currentCost = new Int32Array(needleLength + 1)
  let previousStart = new Int32Array(needleLength + 1)
  let currentStart = new Int32Array(needleLength + 1)
  for (let row = 0; row <= needleLength; row += 1) previousCost[row] = row
  let best: AlignmentHit = { cost: needleLength, start: 0, end: 0 }

  for (let column = 1; column <= window.length; column += 1) {
    currentCost[0] = 0
    currentStart[0] = column
    const windowChar = window[column - 1]
    for (let row = 1; row <= needleLength; row += 1) {
      let cost = previousCost[row - 1]! + (needle[row - 1] === windowChar ? 0 : 1)
      let start = previousStart[row - 1]!
      const skipWindowChar = previousCost[row]! + 1
      if (skipWindowChar < cost) {
        cost = skipWindowChar
        start = previousStart[row]!
      }
      const skipNeedleChar = currentCost[row - 1]! + 1
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

/** 对角线投票：优先使用低频 gram，总命中数受 MAX_VOTE_POSTINGS 限制 */
function collectCandidateBuckets(needle: string, haystack: string, index: NgramIndex, maxCandidates: number): number[] {
  const gramCount = needle.length - NGRAM_SIZE + 1
  const grams: Array<{ offset: number; from: number; to: number }> = []
  for (let offset = 0; offset < gramCount; offset += 1) {
    const bucket = gramHash(needle, offset) & index.mask
    const from = index.bucketStarts[bucket]!
    const to = index.bucketStarts[bucket + 1]!
    if (to > from) grams.push({ offset, from, to })
  }
  grams.sort((left, right) => left.to - left.from - (right.to - right.from))

  const votes = new Map<number, number>()
  let budget = MAX_VOTE_POSTINGS
  for (const gram of grams) {
    if (budget <= 0) break
    const stop = Math.min(gram.to, gram.from + budget)
    budget -= stop - gram.from
    for (let cursor = gram.from; cursor < stop; cursor += 1) {
      const position = index.positions[cursor]!
      if (!gramEquals(haystack, position, needle, gram.offset)) continue
      const diagonalBucket = Math.floor((position - gram.offset) / DIAGONAL_BUCKET_SIZE)
      votes.set(diagonalBucket, (votes.get(diagonalBucket) ?? 0) + 1)
    }
  }

  const top: Array<{ bucket: number; count: number }> = []
  for (const [bucket, count] of votes) {
    if (top.length < maxCandidates) {
      top.push({ bucket, count })
      top.sort((left, right) => right.count - left.count)
    } else if (count > top[top.length - 1]!.count) {
      top[top.length - 1] = { bucket, count }
      top.sort((left, right) => right.count - left.count)
    }
  }
  return top.map((entry) => entry.bucket)
}

function fuzzyLocate(
  needle: string,
  prepared: PreparedHaystack,
  maxCandidates: number,
): { start: number; end: number; ratio: number } | null {
  const haystack = prepared.normalized.text
  const buckets = collectCandidateBuckets(needle, haystack, ngramIndexFor(prepared), maxCandidates)
  if (buckets.length === 0) return null

  const slack = Math.max(MIN_WINDOW_SLACK, Math.ceil(needle.length * WINDOW_SLACK_RATIO))
  const windows = buckets
    .map((bucket) => {
      const diagonal = bucket * DIAGONAL_BUCKET_SIZE
      return {
        start: Math.max(0, diagonal - slack),
        end: Math.min(haystack.length, diagonal + DIAGONAL_BUCKET_SIZE + needle.length + slack),
      }
    })
    .sort((left, right) => left.start - right.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const window of windows) {
    const last = merged[merged.length - 1]
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end)
    else merged.push({ ...window })
  }

  const needlePoints = decodeCodePoints(needle).points
  let best: { start: number; end: number; ratio: number } | null = null
  for (const window of merged) {
    const windowText = haystack.slice(window.start, window.end)
    const decodedWindow = decodeCodePoints(windowText)
    const hit = semiGlobalAlign(needlePoints, decodedWindow.points)
    if (hit.end <= hit.start) continue
    const start = window.start + decodedWindow.unitOffsets[hit.start]!
    const end = window.start + decodedWindow.unitOffsets[hit.end]!
    const ratio = similarity(needle, haystack.slice(start, end))
    if (!best || ratio > best.ratio) best = { start, end, ratio }
  }
  return best
}

/**
 * 在长文本中定位一段引文：先在规范串上精确查找（取首次出现），失败再用 n-gram 候选窗口 + 编辑距离模糊定位。
 * 返回原文 haystack 下标；传入 PreparedHaystack 时以其规范化选项为准。
 * 规范后短于 NGRAM_SIZE 的引文只做精确查找。
 */
export function locateInText(
  needle: string,
  haystack: string | PreparedHaystack,
  options: LocateOptions = {},
): LocateResult | null {
  assertString(needle, 'needle')
  const minRatio = options.minRatio ?? TEXT_VARIANT_RATIO
  if (!Number.isFinite(minRatio) || minRatio < 0 || minRatio > 1) {
    throw new RangeError(`locateInText：minRatio 必须在 0..1 之间，实际为 ${minRatio}`)
  }
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_LOCATE_CANDIDATES
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
    throw new RangeError(`locateInText：maxCandidates 必须是正整数，实际为 ${maxCandidates}`)
  }
  const prepared = typeof haystack === 'string' ? prepareHaystack(haystack, options) : haystack
  const normalizedNeedle = normalizeForCompare(needle, prepared.options)
  const normalizedHaystack = prepared.normalized
  if (normalizedNeedle.length === 0 || normalizedHaystack.text.length === 0) return null

  const exactIndex = normalizedHaystack.text.indexOf(normalizedNeedle)
  if (exactIndex >= 0) {
    const range = mapNormalizedRange(normalizedHaystack, exactIndex, exactIndex + normalizedNeedle.length)
    return { ...range, ratio: 1, exact: true }
  }
  if (normalizedNeedle.length < NGRAM_SIZE) return null

  const best = fuzzyLocate(normalizedNeedle, prepared, maxCandidates)
  if (!best || best.ratio + RATIO_EPSILON < minRatio) return null
  const range = mapNormalizedRange(normalizedHaystack, best.start, best.end)
  return { ...range, ratio: best.ratio, exact: false }
}
