import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TEXT_AGREE_RATIO,
  TEXT_VARIANT_RATIO,
  classifyTextMatch,
  diffSegments,
  editDistance,
  locateInText,
  mapNormalizedRange,
  normalizeForCompare,
  normalizeVariants,
  prepareHaystack,
  similarity,
  stripForCompare,
  toSimplified,
} from './text-normalize.ts'

const MIN_VARIANT_ENTRIES = 60
const PERF_HAYSTACK_LENGTH = 300_000
const PERF_QUERY_COUNT = 100
const PERF_TIME_LIMIT_MS = 2_000
const PERF_MIN_NEEDLE_LENGTH = 30
const PERF_NEEDLE_LENGTH_SPAN = 40
const LONG_TEXT_LENGTH = 5_000
const LONG_TEXT_SUBSTITUTIONS = 50

/** Kanripo 风格样例：繁体无标点、含 ¶ 与页码标记、含异体字 */
const KANRIPO_SAMPLE =
  '¶<pb:KR3e0001_SBCK_001-1a>太陽之為病脈浮頭項强痛而惡寒¶太陽病發熱汗出惡風脈緩者名為中風¶' +
  '太陽病或已發熱或未發熱必惡寒體痛嘔逆脈陰陽俱緊者名為傷寒<pb:KR3e0001_SBCK_001-1b>¶' +
  '傷寒一日太陽受之脈若静者為不傳頗欲吐若躁煩脈數急者為傳也¶傷寒脈浮滑此以表有熱裏有寒白虎湯主之¶' +
  '傷寒心下痞鞕噫氣不除者旋覆代赭湯主之'

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

const SYNTHETIC_CHAR_POOL = Array.from(
  '太陽陰病發熱汗出惡風寒脈浮緩緊弱數遲沈細微滑澀弦大小者名為中傷溫瘧嘔吐下利腹滿痛煩躁渴欲飲水心痞鞕胸脇苦' +
    '往來頭項強身疼腰骨節無喘而主之桂枝麻黃葛根柴胡芩半夏人參甘草生薑棗芍藥茯苓白朮附子乾辛五味石膏知母粳米' +
    '杏仁厚朴枳實芒硝梔豉當歸川芎地阿膠',
)
const SYNTHETIC_PHRASES = ['太陽病', '發熱汗出', '脈浮緊', '主之', '桂枝湯', '小柴胡湯']
const SYNTHETIC_PUNCTUATION = Array.from('，。；：、')

function buildSyntheticHaystack(targetLength: number, random: () => number): string {
  const parts: string[] = []
  let length = 0
  let sinceBreak = 0
  let page = 1
  while (length < targetLength) {
    const piece =
      random() < 0.15
        ? SYNTHETIC_PHRASES[Math.floor(random() * SYNTHETIC_PHRASES.length)]!
        : SYNTHETIC_CHAR_POOL[Math.floor(random() * SYNTHETIC_CHAR_POOL.length)]!
    parts.push(piece)
    length += piece.length
    sinceBreak += piece.length
    if (random() < 0.12) {
      parts.push(SYNTHETIC_PUNCTUATION[Math.floor(random() * SYNTHETIC_PUNCTUATION.length)]!)
      length += 1
    }
    if (sinceBreak > 2_000) {
      const marker = `¶\n<pb:KR3e0007_SBCK_${String(page).padStart(3, '0')}-1a>`
      parts.push(marker)
      length += marker.length
      sinceBreak = 0
      page += 1
    }
  }
  return parts.join('')
}

describe('toSimplified', () => {
  it('converts traditional to simplified', () => {
    expect(toSimplified('傷寒論')).toBe('伤寒论')
    expect(toSimplified('太陽病，發熱汗出')).toBe('太阳病，发热汗出')
  })
})

describe('normalizeVariants / normalizeForCompare', () => {
  it('unifies traditional and simplified forms', () => {
    expect(normalizeForCompare('陽浮而陰弱')).toBe(normalizeForCompare('阳浮而阴弱'))
    expect(normalizeForCompare('陽浮而陰弱')).toBe('阳浮而阴弱')
  })

  it('unifies common variant characters', () => {
    expect(normalizeForCompare('心下痞鞕')).toBe(normalizeForCompare('心下痞硬'))
    expect(normalizeForCompare('脈㣲細，畧𥙷蚘')).toBe('脉微细略补蛔')
    expect(normalizeForCompare('鍼灸')).toBe('针灸')
    expect(normalizeVariants('鞕')).toBe('硬')
    expect(normalizeVariants('太陽病')).toBe('太陽病')
  })

  it('keeps 证/症 distinct by default and merges on demand', () => {
    expect(normalizeVariants('症')).toBe('症')
    expect(normalizeForCompare('此为太阳证')).not.toBe(normalizeForCompare('此为太阳症'))
    expect(normalizeForCompare('此为太阳证', { mergeZhengZheng: true })).toBe(
      normalizeForCompare('此为太阳症', { mergeZhengZheng: true }),
    )
    expect(normalizeVariants('症', { mergeZhengZheng: true })).toBe('证')
  })

  it('folds compatibility ideographs and full-width forms', () => {
    expect(normalizeForCompare('\uF9F4\uFF11')).toBe(normalizeForCompare('林1'))
  })

  it('rejects non-string input', () => {
    expect(() => normalizeForCompare(undefined as unknown as string)).toThrow(TypeError)
  })
})

describe('stripForCompare', () => {
  it('removes punctuation, whitespace, pilcrow and page markers', () => {
    expect(stripForCompare('太陽病，發熱¶汗出。<pb:KR3e0007_SBCK_001-1a>惡寒 「者」！\u3000\n')).toBe(
      '太陽病發熱汗出惡寒者',
    )
  })

  it('keeps parenthetical notes unless stripNotes is set', () => {
    const text = '桂枝三兩(去皮)芍藥（三兩）甘草'
    expect(stripForCompare(text)).toBe('桂枝三兩去皮芍藥三兩甘草')
    expect(stripForCompare(text, { stripNotes: true })).toBe('桂枝三兩芍藥甘草')
  })

  it('handles nested and unbalanced parentheses', () => {
    expect(stripForCompare('甲(乙(丙)丁)戊', { stripNotes: true })).toBe('甲戊')
    expect(stripForCompare('甲(乙(丙)丁', { stripNotes: true })).toBe('甲乙丁')
    expect(stripForCompare('甲)乙', { stripNotes: true })).toBe('甲乙')
  })
})

describe('offsetMap', () => {
  it('maps normalized positions back to the original text', () => {
    const original = '太陽病，發熱¶汗出<pb:KR3e0007_SBCK_001-1a>而惡寒'
    const result = normalizeForCompare(original, { withOffsets: true })
    expect(result.text).toBe('太阳病发热汗出而恶寒')
    expect(result.offsetMap.length).toBe(result.text.length)
    expect(result.offsetMap[result.text.indexOf('汗')]).toBe(original.indexOf('汗'))
    expect(result.offsetMap[result.text.indexOf('而')]).toBe(original.indexOf('而'))
    for (let index = 0; index < result.text.length; index += 1) {
      const sourceChar = original.slice(result.offsetMap[index], result.offsetEndMap[index])
      expect(normalizeForCompare(sourceChar)).toBe(result.text[index])
    }
    const range = mapNormalizedRange(result, result.text.indexOf('汗'), result.text.length)
    expect(original.slice(range.start, range.end)).toBe('汗出<pb:KR3e0007_SBCK_001-1a>而惡寒')
  })

  it('handles astral-plane variants', () => {
    const result = normalizeForCompare('𥙷中', { withOffsets: true })
    expect(result.text).toBe('补中')
    expect(Array.from(result.offsetMap)).toEqual([0, 2])
    expect(Array.from(result.offsetEndMap)).toEqual([2, 3])
  })

  it('rejects invalid ranges', () => {
    const result = normalizeForCompare('太陽', { withOffsets: true })
    expect(() => mapNormalizedRange(result, 1, 1)).toThrow(RangeError)
    expect(() => mapNormalizedRange(result, 0, 3)).toThrow(RangeError)
  })
})

describe('similarity / editDistance', () => {
  it('handles boundaries', () => {
    expect(similarity('', '')).toBe(1)
    expect(similarity('', '太阳')).toBe(0)
    expect(similarity('太阳病', '')).toBe(0)
    expect(similarity('太阳病', '太阳病')).toBe(1)
    expect(similarity('甲乙丙', '丁戊己')).toBe(0)
  })

  it('equals 1 - levenshtein / max length', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(similarity('kitten', 'sitting')).toBeCloseTo(1 - 3 / 7, 12)
    expect(similarity('太阳病发热', '太阳病恶热')).toBeCloseTo(0.8, 12)
  })

  it('counts astral characters as one code point', () => {
    expect(editDistance('𥙷', '补')).toBe(1)
    expect(similarity('甲𥙷', '甲补')).toBe(0.5)
  })

  it('stays bounded on very long inputs', () => {
    const random = createRandom(7)
    const base = Array.from(
      { length: LONG_TEXT_LENGTH },
      () => SYNTHETIC_CHAR_POOL[Math.floor(random() * SYNTHETIC_CHAR_POOL.length)]!,
    )
    const mutated = [...base]
    const step = Math.floor(LONG_TEXT_LENGTH / LONG_TEXT_SUBSTITUTIONS)
    for (let index = 0; index < LONG_TEXT_SUBSTITUTIONS; index += 1) mutated[index * step + 1] = '龘'
    const startedAt = performance.now()
    const ratio = similarity(base.join(''), mutated.join(''))
    expect(performance.now() - startedAt).toBeLessThan(PERF_TIME_LIMIT_MS)
    expect(ratio).toBeCloseTo(1 - LONG_TEXT_SUBSTITUTIONS / LONG_TEXT_LENGTH, 6)
  })
})

describe('classifyTextMatch', () => {
  it('applies thresholds inclusively', () => {
    expect(TEXT_AGREE_RATIO).toBe(0.95)
    expect(TEXT_VARIANT_RATIO).toBe(0.8)
    expect(classifyTextMatch(1)).toBe('agree')
    expect(classifyTextMatch(TEXT_AGREE_RATIO)).toBe('agree')
    expect(classifyTextMatch(1 - 1 / 20)).toBe('agree')
    expect(classifyTextMatch(0.9499)).toBe('variant')
    expect(classifyTextMatch(TEXT_VARIANT_RATIO)).toBe('variant')
    expect(classifyTextMatch(1 - 4 / 20)).toBe('variant')
    expect(classifyTextMatch(0.7999)).toBe('mismatch')
    expect(classifyTextMatch(0)).toBe('mismatch')
  })

  it('rejects out-of-range ratios', () => {
    expect(() => classifyTextMatch(Number.NaN)).toThrow(RangeError)
    expect(() => classifyTextMatch(-0.1)).toThrow(RangeError)
    expect(() => classifyTextMatch(1.1)).toThrow(RangeError)
  })
})

describe('locateInText', () => {
  it('finds exact quotations across scripts and punctuation', () => {
    const result = locateInText('太阳病，或已发热，或未发热，必恶寒，体痛，呕逆，脉阴阳俱紧者，名为伤寒。', KANRIPO_SAMPLE)
    expect(result).not.toBeNull()
    expect(result!.exact).toBe(true)
    expect(result!.ratio).toBe(1)
    expect(KANRIPO_SAMPLE.slice(result!.start, result!.end)).toBe(
      '太陽病或已發熱或未發熱必惡寒體痛嘔逆脈陰陽俱緊者名為傷寒',
    )
  })

  it('finds quotations with one or two variant readings', () => {
    const prepared = prepareHaystack(KANRIPO_SAMPLE)

    const twoReadings = locateInText('伤寒心下痞硬，嗳气不除者，旋复代赭汤主之。', prepared)
    expect(twoReadings).not.toBeNull()
    expect(twoReadings!.exact).toBe(false)
    expect(KANRIPO_SAMPLE.slice(twoReadings!.start, twoReadings!.end)).toBe('傷寒心下痞鞕噫氣不除者旋覆代赭湯主之')
    expect(twoReadings!.ratio).toBeCloseTo(1 - 2 / 18, 12)
    expect(classifyTextMatch(twoReadings!.ratio)).toBe('variant')

    const oneMissing = locateInText('伤寒脉浮滑，此表有热，里有寒，白虎汤主之。', prepared)
    expect(oneMissing).not.toBeNull()
    expect(oneMissing!.exact).toBe(false)
    expect(KANRIPO_SAMPLE.slice(oneMissing!.start, oneMissing!.end)).toBe('傷寒脈浮滑此以表有熱裏有寒白虎湯主之')
    expect(oneMissing!.ratio).toBeCloseTo(1 - 1 / 18, 12)
  })

  it('returns null when nothing matches', () => {
    const prepared = prepareHaystack(KANRIPO_SAMPLE)
    expect(locateInText('黄帝问曰余闻上古之人春秋皆度百岁', prepared)).toBeNull()
    expect(locateInText('黄帝', prepared)).toBeNull()
    expect(locateInText('，。！', prepared)).toBeNull()
    expect(locateInText('太阳病', '')).toBeNull()
  })

  it('validates options', () => {
    expect(() => locateInText('太阳病', KANRIPO_SAMPLE, { minRatio: 2 })).toThrow(RangeError)
    expect(() => locateInText('太阳病', KANRIPO_SAMPLE, { maxCandidates: 0 })).toThrow(RangeError)
  })

  it(`locates ${PERF_QUERY_COUNT} quotations in a ${PERF_HAYSTACK_LENGTH}-char text within ${PERF_TIME_LIMIT_MS} ms`, () => {
    const random = createRandom(20261009)
    const haystack = buildSyntheticHaystack(PERF_HAYSTACK_LENGTH, random)
    expect(haystack.length).toBeGreaterThanOrEqual(PERF_HAYSTACK_LENGTH)

    const startedAt = performance.now()
    const prepared = prepareHaystack(haystack)
    const preparedAt = performance.now()
    const normalized = prepared.normalized
    let exactHits = 0
    let fuzzyHits = 0
    for (let query = 0; query < PERF_QUERY_COUNT; query += 1) {
      const needleLength = PERF_MIN_NEEDLE_LENGTH + Math.floor(random() * PERF_NEEDLE_LENGTH_SPAN)
      const position = Math.floor(random() * (normalized.text.length - needleLength))
      const chars = normalized.text.slice(position, position + needleLength).split('')
      const withReadings = query % 2 === 1
      if (withReadings) {
        chars[5] = '龘'
        chars[needleLength - 6] = '鑫'
      }
      const result = locateInText(chars.join(''), prepared)
      expect(result, `query ${query}`).not.toBeNull()
      expect(result!.start, `query ${query}`).toBe(normalized.offsetMap[position])
      expect(result!.end, `query ${query}`).toBe(normalized.offsetEndMap[position + needleLength - 1])
      expect(result!.exact).toBe(!withReadings)
      if (result!.exact) exactHits += 1
      else fuzzyHits += 1
    }
    const finishedAt = performance.now()
    console.info(
      `[text-normalize perf] haystack=${haystack.length} prepare=${(preparedAt - startedAt).toFixed(0)}ms ` +
        `queries=${PERF_QUERY_COUNT} (exact ${exactHits}, fuzzy ${fuzzyHits}) locate=${(finishedAt - preparedAt).toFixed(0)}ms ` +
        `total=${(finishedAt - startedAt).toFixed(0)}ms`,
    )
    expect(finishedAt - startedAt).toBeLessThan(PERF_TIME_LIMIT_MS)
  })
})

describe('diffSegments', () => {
  function joinSides(segments: ReturnType<typeof diffSegments>): { a: string; b: string } {
    return { a: segments.map((segment) => segment.a).join(''), b: segments.map((segment) => segment.b).join('') }
  }

  it('reports replacements, deletions and insertions', () => {
    expect(diffSegments('太阳病发热', '太阳病恶热')).toEqual([
      { op: 'equal', a: '太阳病', b: '太阳病' },
      { op: 'replace', a: '发', b: '恶' },
      { op: 'equal', a: '热', b: '热' },
    ])
    expect(diffSegments('桂枝汤主之', '桂枝汤')).toEqual([
      { op: 'equal', a: '桂枝汤', b: '桂枝汤' },
      { op: 'delete', a: '主之', b: '' },
    ])
    expect(diffSegments('脉浮', '脉浮紧')).toEqual([
      { op: 'equal', a: '脉浮', b: '脉浮' },
      { op: 'insert', a: '', b: '紧' },
    ])
    expect(diffSegments('', '')).toEqual([])
    expect(diffSegments('甲', '')).toEqual([{ op: 'delete', a: '甲', b: '' }])
  })

  it('keeps astral characters intact', () => {
    expect(diffSegments('𥙷中', '补中')).toEqual([
      { op: 'replace', a: '𥙷', b: '补' },
      { op: 'equal', a: '中', b: '中' },
    ])
  })

  it('reassembles both sides, including chunked long inputs', () => {
    const sample = diffSegments('伤寒心下痞硬嗳气不除者', '伤寒心下痞鞕噫气不除者旋覆')
    expect(joinSides(sample)).toEqual({ a: '伤寒心下痞硬嗳气不除者', b: '伤寒心下痞鞕噫气不除者旋覆' })

    const random = createRandom(11)
    const longA = Array.from({ length: 3_000 }, () => SYNTHETIC_CHAR_POOL[Math.floor(random() * SYNTHETIC_CHAR_POOL.length)]!).join('')
    const longB = `甲${longA.slice(0, 1_500)}乙${longA.slice(1_501)}丙`
    expect(joinSides(diffSegments(longA, longB))).toEqual({ a: longA, b: longB })
  })
})

describe('variant-chars.json', () => {
  const table = JSON.parse(
    readFileSync(path.join(process.cwd(), 'data/ontology/variant-chars.json'), 'utf8'),
  ) as {
    source: string
    variants: Array<{ from: string; to: string; kind: string }>
    optional: { mergeZhengZheng: { default: boolean; pairs: Array<{ from: string; to: string }> } }
  }

  it('has enough documented entries without chains', () => {
    expect(table.source).toBe('常见异体字整理')
    expect(table.variants.length).toBeGreaterThanOrEqual(MIN_VARIANT_ENTRIES)
    const fromChars = new Set(table.variants.map((entry) => entry.from))
    expect(fromChars.size).toBe(table.variants.length)
    for (const entry of table.variants) {
      expect(fromChars.has(entry.to), `${entry.from}→${entry.to}`).toBe(false)
      expect(normalizeForCompare(entry.to), `${entry.to} 应在 opencc 下保持不变`).toBe(entry.to)
    }
  })

  it('keeps 证/症 out of the default mapping', () => {
    const fromChars = new Set(table.variants.map((entry) => entry.from))
    expect(fromChars.has('症')).toBe(false)
    expect(fromChars.has('证')).toBe(false)
    expect(table.optional.mergeZhengZheng.default).toBe(false)
    expect(table.optional.mergeZhengZheng.pairs).toEqual([{ from: '症', to: '证' }])
  })
})
