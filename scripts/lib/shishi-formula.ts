import type { FormulaHerb } from '../../src/types/data.ts'
import { type ChenfuFormulaBlock, extractDerivedFrom, parseChenfuHerbToken } from './chenfu-formula.ts'
import { segmentHerbNames } from './herb-lexicon.ts'
import { toSimplifiedChinese } from './wiki.ts'

/**
 * 《石室秘录》方药写法：「方用人参三两，白术五两，……水煎服。（〔批〕补气消痰饮。）」
 * 药味为「药名+剂量」逗号串，方名多见于其后的〔批〕注。
 */

const NUM = '零〇一二三四五六七八九十百半壹贰叁肆伍陆柒捌玖拾\\d.'
const UNIT = '两|钱|分|厘|个|枚|片|粒|斤|茎'
const DOSE = `[${NUM}]+(?:${UNIT})半?(?:[${NUM}]+(?:钱|分|厘))?`
const HERB_ITEM = `[\\u4e00-\\u9fff]{1,8}?各?${DOSE}`
const HERB_GROUP = `(?:[\\u4e00-\\u9fff]{1,6}、)*${HERB_ITEM}`
const SEPARATOR = '\\s*[，,、]\\s*'

/** 「方用人参……」或「治小儿疟疾方∶柴胡六分……」 */
const HERB_RUN_RE = new RegExp(`(?:用|方[∶:])\\s*(${HERB_GROUP}(?:${SEPARATOR}${HERB_GROUP})*)`, 'g')
const HERB_GROUP_RE = new RegExp(HERB_GROUP, 'g')
const SHARED_DOSE_RE = new RegExp(`^(.+?)各(${DOSE})$`)

/** 原文偶有批注缺右括号（霸治法「（〔批〕定吐至神丹。雷公曰∶…」），以段落结尾为界 */
const ANNOTATION_RE = /[（(]〔批〕([^）)\n]*)[）)]?/g
const FORMULA_SUFFIX = '汤|散|丸|丹|饮|膏|煎'
const ANNOTATION_NAME_RE = new RegExp(`^[\\u4e00-\\u9fff]{2,12}(?:${FORMULA_SUFFIX})$`)
const INLINE_NAME_RE = new RegExp(`(?:方名|名曰|名为)\\s*([\\u4e00-\\u9fff]{2,12}?(?:${FORMULA_SUFFIX}))`)

/** 「痈疽方∶用……」：标签须在句读之后、紧贴药味串 */
const ADJACENT_TOPIC_RE = /[∶:。，,；;\n]([\u4e00-\u9fff]{2,7})方[∶:，,]\s*用?\s*$/
/** 「大泻者，……」「大满之症，……」「大吐方，……」：段首病名 */
const PARAGRAPH_TOPIC_RE = /^([\u4e00-\u9fff]{2,4}?)(?:者|之症|之病|方)[，,∶:]/
/** 病名标签中出现这些字，多为「更有一方」「予亦定一方」之类叙述 */
const TOPIC_STOP_CHARS_RE = /[一二三四五此其有之予吾余我传立用定更再亦尚可乃盖今以服初已又另前后能不第治在]/
/** 「至于中暑之病」「痿症奇方」中的连词与褒词不属病名 */
const TOPIC_LEADING_CONNECTIVE_RE = /^(?:至于|至如|若夫|若|凡|夫|治)/
const TOPIC_TRAILING_PRAISE_RE = /(?:奇|神|妙)+$/
/** 前置句读 + 最长 7 字（含「治」）病名 + 方 + 标点 + 用 */
const ADJACENT_TOPIC_WINDOW = 12

/** 药味串至〔批〕方名之间允许的最大字数（如「各为末，蜜为丸。每日白滚水送下五钱，」） */
const MAX_ANNOTATION_GAP = 80
/** 至少两味才视为方剂，避免论述中「用人参一两」被误收 */
const MIN_HERBS_PER_FORMULA = 2

interface Annotation {
  start: number
  end: number
  content: string
}

export function extractAnnotationFormulaName(content: string): string | undefined {
  const head = toSimplifiedChinese(content).split(/[。，,∶:；;]/)[0]?.trim() ?? ''
  const name = head.replace(new RegExp(`(${FORMULA_SUFFIX})方$`), '$1')
  return ANNOTATION_NAME_RE.test(name) ? name : undefined
}

function collectAnnotations(text: string): Annotation[] {
  const annotations: Annotation[] = []
  for (const match of text.matchAll(ANNOTATION_RE)) {
    annotations.push({
      start: match.index!,
      end: match.index! + match[0].length,
      content: match[1] ?? '',
    })
  }
  return annotations
}

/** 批注内另有雷公/孙公附方，等长替换以保持下标不变 */
function maskAnnotations(text: string, annotations: Annotation[]): string {
  let masked = text
  for (const annotation of annotations) {
    const length = annotation.end - annotation.start
    masked = masked.slice(0, annotation.start) + '※'.repeat(length) + masked.slice(annotation.end)
  }
  return masked
}

function expandHerbGroup(group: string, lexicon?: string[]): string[] {
  const shared = group.match(SHARED_DOSE_RE)
  // 「人参一两、白术三两」顿号也可作药味分隔
  if (!shared) return group.split('、').filter(Boolean)
  const namesPart = shared[1]!
  const dose = shared[2]!
  const names = namesPart.includes('、')
    ? namesPart.split('、').filter(Boolean)
    : segmentHerbNames(namesPart, lexicon)
  return names.length > 0 ? names.map((name) => `${name}${dose}`) : [group]
}

/** 「加黄连三钱」中的加减用语 */
const HERB_LEAD_VERB_RE = /^(?:加|再加|又加)/
/** 「煎汤一分」「石膏必须至三四两」「或半斤」「独参汤三两」：叙述或他方，并非药味（丹/丸/膏会误伤铅丹、雷丸、石膏） */
const NON_HERB_NAME_RE = /必须|煎汤|^或|汤$/

export function parseShishiHerbRun(run: string, lexicon?: string[]): FormulaHerb[] {
  const herbs: FormulaHerb[] = []
  const seen = new Set<string>()
  for (const groupMatch of run.matchAll(HERB_GROUP_RE)) {
    for (const rawToken of expandHerbGroup(groupMatch[0], lexicon)) {
      const token = rawToken.replace(HERB_LEAD_VERB_RE, '')
      const herb = parseChenfuHerbToken(token)
      if (herb && NON_HERB_NAME_RE.test(herb.name)) continue
      if (!herb || seen.has(herb.herbId)) continue
      seen.add(herb.herbId)
      herbs.push(herb)
    }
  }
  return herbs
}

function acceptTopic(rawTopic: string | undefined): string | undefined {
  const topic = rawTopic
    ?.replace(TOPIC_LEADING_CONNECTIVE_RE, '')
    .replace(TOPIC_TRAILING_PRAISE_RE, '')
  // 「治肾方者」是在泛论一类方，不是病名
  if (!topic || topic.length < 2 || topic.endsWith('方') || TOPIC_STOP_CHARS_RE.test(topic)) {
    return undefined
  }
  return `${topic}方`
}

/**
 * 无〔批〕方名时，取原文对该方的病名称呼作描述性名称（「痈疽方」「大泻方」）。
 */
export function inferShishiTopicName(maskedText: string, runStart: number): string | undefined {
  const paragraphStart = maskedText.lastIndexOf('\n', runStart - 1) + 1
  const windowStart = Math.max(paragraphStart, runStart - ADJACENT_TOPIC_WINDOW)
  const boundary = windowStart === paragraphStart ? '\n' : ''
  const before = boundary + maskedText.slice(windowStart, runStart)
  const adjacent = acceptTopic(before.match(ADJACENT_TOPIC_RE)?.[1])
  if (adjacent) return adjacent
  return acceptTopic(maskedText.slice(paragraphStart, runStart).match(PARAGRAPH_TOPIC_RE)?.[1])
}

function stripLeadingPunctuation(text: string): string {
  return text.replace(/^[，,。、\s]+/, '').trim()
}

/**
 * 从石室秘录一条正文中提取方剂块；无此写法时返回空数组，由通用解析器兜底。
 */
export function extractShishiFormulaBlocks(
  body: string,
  options?: { anonymousPrefix?: string; lexicon?: string[] },
): ChenfuFormulaBlock[] {
  const text = toSimplifiedChinese(body)
  const annotations = collectAnnotations(text)
  const masked = maskAnnotations(text, annotations)

  const runs: Array<{
    start: number
    end: number
    herbs: FormulaHerb[]
    introRaw: string
    topicName?: string
  }> = []
  for (const match of masked.matchAll(HERB_RUN_RE)) {
    const herbs = parseShishiHerbRun(match[1]!, options?.lexicon)
    if (herbs.length < MIN_HERBS_PER_FORMULA) continue
    const start = match.index!
    const herbListStart = start + match[0].indexOf(match[1]!)
    const sentenceStart = Math.max(
      masked.lastIndexOf('。', start),
      masked.lastIndexOf('\n', start),
    )
    runs.push({
      start,
      end: start + match[0].length,
      herbs,
      introRaw: text.slice(sentenceStart + 1, start + 1).trim(),
      topicName: inferShishiTopicName(masked, herbListStart),
    })
  }

  const topicCounts = new Map<string, number>()
  for (const run of runs) {
    if (run.topicName) topicCounts.set(run.topicName, (topicCounts.get(run.topicName) ?? 0) + 1)
  }
  const topicSeen = new Map<string, number>()

  const blocks: ChenfuFormulaBlock[] = []
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex]!
    const nextRunStart = runs[runIndex + 1]?.start ?? text.length

    const annotation = annotations.find(
      (item) =>
        item.start >= run.end &&
        item.start < nextRunStart &&
        item.start - run.end <= MAX_ANNOTATION_GAP &&
        extractAnnotationFormulaName(item.content),
    )

    let preparationEnd: number
    if (annotation) {
      preparationEnd = annotation.start
    } else {
      const sentenceEnd = masked.indexOf('。', run.end)
      preparationEnd = sentenceEnd >= 0 && sentenceEnd < nextRunStart ? sentenceEnd + 1 : nextRunStart
    }
    const preparation = stripLeadingPunctuation(text.slice(run.end, preparationEnd))
    const fangjieStart = annotation ? annotation.end : preparationEnd
    const fangjie = stripLeadingPunctuation(
      text.slice(fangjieStart, Math.max(fangjieStart, nextRunStart)),
    )

    // 「水煎服。方名静待汤。」：方名常在首句句号之后
    const inlineWindow = text.slice(run.end, Math.min(run.end + 160, nextRunStart))
    const detectedName =
      (annotation && extractAnnotationFormulaName(annotation.content)) ??
      preparation.match(INLINE_NAME_RE)?.[1] ??
      inlineWindow.match(INLINE_NAME_RE)?.[1] ??
      run.introRaw.match(INLINE_NAME_RE)?.[1]
    let name = detectedName ?? `${options?.anonymousPrefix ?? '无名方'}·方${runIndex + 1}`
    if (!detectedName && run.topicName) {
      const ordinal = (topicSeen.get(run.topicName) ?? 0) + 1
      topicSeen.set(run.topicName, ordinal)
      name = topicCounts.get(run.topicName)! > 1 ? `${run.topicName}${ordinal}` : run.topicName
    }

    blocks.push({
      name,
      herbs: run.herbs,
      preparation,
      fangjie,
      role: blocks.length === 0 ? 'main' : 'alternate',
      anonymous: !detectedName,
      derivedFrom: extractDerivedFrom(fangjie),
      introRaw: run.introRaw,
    })
  }
  return blocks
}
