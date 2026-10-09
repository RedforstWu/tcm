import { describe, expect, it } from 'vitest'
import type { Evidence } from '../../src/types/data.ts'
import {
  DEFAULT_SETTINGS,
  GAP_CHAR,
  MISSING_RATIO_FLOOR,
  OPTIONAL_GAP_CHAR,
  aggregatePieces,
  buildCollationRecord,
  buildVariantSegments,
  chapterHotspots,
  classifyCollationRatio,
  clauseDiffRuns,
  collateWitness,
  collectReplacePairs,
  countGapMatches,
  demoteStrayPieces,
  evenlySample,
  gapAwareDistance,
  gapAwareRatio,
  maskGaps,
  mergeRankedPairs,
  monotonicWindow,
  pickMonotonicHit,
  pieceBoundaries,
  prepareCollationHaystack,
  prepareCollationNeedle,
  rankReplacePairs,
  semiGlobalGapAlign,
  tallyVerdicts,
  verdictOf,
  type ClauseMatch,
  type GapScheme,
  type PieceMatch,
  type RankedPair,
} from './collate.ts'

const toPoints = (text: string): Int32Array => Int32Array.from([...text].map((char) => char.codePointAt(0)!))

const EVIDENCE: Evidence = {
  sourceId: 'jobkoko@0000000',
  group: 'web-simplified',
  locator: 'S-000-测试.txt#测试篇',
  quote: '测试',
  license: 'unknown',
}

function collateOne(source: string, scheme: GapScheme, text: string) {
  const haystack = prepareCollationHaystack(source, scheme)
  const [outcome] = collateWitness([{ id: 'c1', text }], haystack)
  expect(outcome).toBeDefined()
  return { haystack, needle: outcome!.needle, match: outcome!.match }
}

function fakeMatch(ratio: number, found = true): ClauseMatch {
  return {
    found,
    ratio,
    plainRatio: ratio,
    exact: false,
    strategy: found ? 'window' : null,
    viaGlobal: false,
    structuralGaps: 0,
    structuralChars: 0,
    pointStart: 0,
    pointEnd: found ? 5 : 0,
    start: 0,
    end: found ? 5 : 0,
    hitCount: 0,
    pieces: [],
    matchedPieces: found ? 1 : 0,
    outOfOrder: false,
    bestRatio: ratio,
  }
}

describe('maskGaps 缺字通配', () => {
  it('Kanripo 实体与组字式替换为严格通配且长度不变', () => {
    const source = '大&KR0037;一枚[虫+忍]行'
    const masked = maskGaps(source, 'kanripo')
    expect(masked.text).toHaveLength(source.length)
    expect(masked.strictGaps).toBe(2)
    expect(masked.optionalGaps).toBe(0)
    expect(masked.text.startsWith(`大${GAP_CHAR}`)).toBe(true)
    expect(masked.text).not.toContain('&KR')
  })

  it('Kanripo 不把汉字间空格当缺字', () => {
    expect(maskGaps('黄芩　人参', 'kanripo').optionalGaps).toBe(0)
  })

  it('jobkoko 的 KT 为严格通配，孤立空格为可选通配', () => {
    const masked = maskGaps('黄KT 汤，黄 芪', 'jobkoko')
    expect(masked.strictGaps).toBe(1)
    expect(masked.optionalGaps).toBe(1)
    expect(masked.text).toHaveLength('黄KT 汤，黄 芪'.length)
    expect(masked.text).toContain(OPTIONAL_GAP_CHAR)
  })

  it('jobkoko 清除 \\x 标记、行首条号，并修正「香港脚」', () => {
    const source = '\\x桂枝汤方\\x\n10．狐惑之为病\n藏象之图\\ps8a2.bmp\\r\n治香港脚冲心'
    const masked = maskGaps(source, 'jobkoko')
    expect(masked.text).toHaveLength(source.length)
    expect(masked.markup).toBe(4)
    expect(masked.text).not.toContain('bmp')
    expect(masked.conversionFixes).toBe(1)
    expect(masked.text).toContain('脚气')
    expect(masked.text).not.toContain('\\x')
    expect(masked.text).not.toContain('10．')
  })

  it('「病患→病人」仅在全文无「病人」时修正；「浓朴→厚朴」无条件修正', () => {
    const converted = maskGaps('问曰：病患有气色，浓朴麻黄汤主之', 'jobkoko')
    expect(converted.conversionFixes).toBe(2)
    expect(converted.text).toContain('病人')
    expect(converted.text).toContain('厚朴')
    const genuine = maskGaps('病人身热，久有病患', 'jobkoko')
    expect(genuine.conversionFixes).toBe(0)
    expect(genuine.text).toContain('病患')
  })

  it('本项目文本只把孤立空格当可选通配，KT 与 \\x 不处理', () => {
    const masked = maskGaps('黄 芪KT\\x', 'local')
    expect(masked.optionalGaps).toBe(1)
    expect(masked.strictGaps).toBe(0)
    expect(masked.markup).toBe(0)
  })

  it('转换修正对本项目文本同样生效，对 Kanripo 不生效', () => {
    expect(maskGaps('浓朴三物汤', 'local').conversionFixes).toBe(1)
    expect(maskGaps('浓朴三物汤', 'kanripo').conversionFixes).toBe(0)
  })

  it('非汉字两侧的空格不算孤立空格', () => {
    expect(maskGaps('黄 a 芪', 'local').optionalGaps).toBe(0)
  })

  it('未知 scheme 报错', () => {
    expect(() => maskGaps('甲', 'other' as GapScheme)).toThrow(/未知 scheme/)
  })
})

describe('预处理保留占位字符', () => {
  it('条文中的可选通配不计入有效长度，紧凑串中去掉', () => {
    const needle = prepareCollationNeedle('黄 汤主之')
    expect(needle.gapCounts.optional).toBe(1)
    expect(needle.effectiveLength).toBe(4)
    expect(needle.compact).toBe('黄汤主之')
  })

  it('见证本严格通配位置被记录', () => {
    const haystack = prepareCollationHaystack('甲&KR0001;乙', 'kanripo')
    expect(haystack.gapCounts.strict).toBe(1)
    expect([...haystack.strictGapPoints]).toEqual([1])
  })
})

describe('带通配的编辑距离', () => {
  it('严格通配可替换任意一个字，但删除仍计代价', () => {
    expect(gapAwareDistance(toPoints(`黄${GAP_CHAR}汤`), toPoints('黄芪汤'))).toBe(0)
    expect(gapAwareDistance(toPoints(`黄${GAP_CHAR}汤`), toPoints('黄汤'))).toBe(1)
  })

  it('可选通配既可替换也可零代价删除', () => {
    expect(gapAwareDistance(toPoints(`黄${OPTIONAL_GAP_CHAR}汤`), toPoints('黄芪汤'))).toBe(0)
    expect(gapAwareDistance(toPoints(`黄${OPTIONAL_GAP_CHAR}汤`), toPoints('黄汤'))).toBe(0)
  })

  it('普通替换与相似度', () => {
    expect(gapAwareDistance(toPoints('甲乙丙'), toPoints('甲丁丙'))).toBe(1)
    expect(gapAwareRatio(toPoints('甲乙丙'), toPoints('甲丁丙'))).toBeCloseTo(2 / 3, 6)
    expect(gapAwareRatio(new Int32Array(0), new Int32Array(0))).toBe(1)
  })

  it('半全局对齐只截取窗口中的命中段', () => {
    const span = semiGlobalGapAlign(toPoints('桂枝汤'), toPoints('甲乙桂枝汤丙'))
    expect(span).toEqual({ cost: 0, start: 2, end: 5 })
    const gapSpan = semiGlobalGapAlign(toPoints('桂枝汤'), toPoints(`甲桂${GAP_CHAR}汤`))
    expect(gapSpan.cost).toBe(0)
  })
})

describe('单调窗口与多处命中', () => {
  it('pickMonotonicHit 取 cursor - backSlack 之后的第一处，否则取最后一处', () => {
    expect(pickMonotonicHit([10, 50, 200], 120, 64)).toBe(2)
    expect(pickMonotonicHit([10, 50, 200], 100, 64)).toBe(1)
    expect(pickMonotonicHit([10, 50, 200], 1000, 64)).toBe(2)
    expect(() => pickMonotonicHit([], 0)).toThrow(/候选为空/)
    expect(() => pickMonotonicHit([5, 1], 0)).toThrow(/升序/)
  })

  it('monotonicWindow 回退 backSlack、向前至少 forwardMin，并裁剪到全文', () => {
    const settings = { backSlack: 64, forwardMin: 3000 }
    expect(monotonicWindow(100, 10, 5000, settings)).toEqual({ start: 36, end: 3100 })
    expect(monotonicWindow(0, 10, 5000, settings)).toEqual({ start: 0, end: 3000 })
    expect(monotonicWindow(100, 10, 500, settings)).toEqual({ start: 36, end: 500 })
    expect(monotonicWindow(0, 2000, 10_000, settings).end).toBe(6000)
  })

  it('短条文多处命中时取上一条之后最近的一处，并在 note 标注', () => {
    const source =
      '太阳病发热汗出恶风脉缓者名为中风。桂枝汤主之。阳明病脉迟汗出多微恶寒者表未解也可发汗。桂枝汤主之。少阳之为病口苦咽干目眩也。桂枝汤主之。'
    const haystack = prepareCollationHaystack(source, 'jobkoko')
    const outcomes = collateWitness(
      [
        { id: 'a', text: '阳明病，脉迟，汗出多，微恶寒者，表未解也，可发汗。' },
        { id: 'b', text: '桂枝汤主之。' },
      ],
      haystack,
      { ...DEFAULT_SETTINGS, backSlack: 0 },
    )
    const short = outcomes[1]!
    expect(short.match.exact).toBe(true)
    expect(short.match.hitCount).toBe(3)
    expect(short.match.start).toBe(source.indexOf('桂枝汤主之', source.indexOf('可发汗')))
    const record = buildCollationRecord({ entityId: 'b', needle: short.needle, match: short.match, evidence: EVIDENCE })
    expect(record.verdict).toBe('agree')
    expect(record.note).toContain('多处命中（3 处')
  })

  it('短条文找不到精确命中时记 missing，不做近似', () => {
    const { needle, match } = collateOne('太阳病发热汗出恶风脉缓者名为中风。', 'jobkoko', '桂枝汤主之。')
    expect(match.found).toBe(false)
    const record = buildCollationRecord({ entityId: 'c1', needle, match, evidence: EVIDENCE })
    expect(record.verdict).toBe('missing')
    expect(record.ratio).toBeUndefined()
    expect(record.note).toContain('短条文仅做精确定位')
  })

  it('短条文可借缺字通配精确命中', () => {
    const { match } = collateOne('少阴病，黄KT汤主之。', 'jobkoko', '黄芪汤主之。')
    expect(match.found).toBe(true)
    expect(match.strategy).toBe('gap-exact')
    expect(match.ratio).toBe(1)
  })
})

describe('分段与结构性插入', () => {
  it('按句读分段，短残段并入前段；过短条文不分段', () => {
    const needle = prepareCollationNeedle('一二三四五六七八九十。甲乙丙丁戊己庚辛壬癸。子丑。')
    const bounds = pieceBoundaries(needle, { pieceLength: 600, minPieceLength: 8 })
    expect(bounds).toEqual([
      { start: 0, end: 10, sentenceEnd: true },
      { start: 10, end: 22, sentenceEnd: true },
    ])
    expect(pieceBoundaries(prepareCollationNeedle('一二三。四五六。'), { pieceLength: 600, minPieceLength: 8 })).toHaveLength(1)
  })

  it('无句读时按 pieceLength 强制切分', () => {
    const needle = prepareCollationNeedle('一'.repeat(25))
    const bounds = pieceBoundaries(needle, { pieceLength: 10, minPieceLength: 4 })
    expect(bounds.map((bound) => [bound.start, bound.end, bound.sentenceEnd])).toEqual([
      [0, 10, false],
      [10, 20, false],
      [20, 25, true],
    ])
  })

  it('见证本在句读处多出的方药块记为结构性插入，不计入 ratio', () => {
    const source =
      '太阳病，发热汗出恶风，脉缓者，名为中风。桂枝汤方：桂枝三两，芍药三两，甘草二两炙，生姜三两切，大枣十二枚擘。桂枝汤主之，其人必自愈也。'
    const { needle, match } = collateOne(source, 'jobkoko', '太阳病，发热汗出恶风，脉缓者，名为中风。桂枝汤主之，其人必自愈也。')
    expect(match.found).toBe(true)
    expect(match.structuralGaps).toBe(1)
    expect(match.structuralChars).toBe(28)
    expect(match.ratio).toBe(1)
    const record = buildCollationRecord({ entityId: 'c1', needle, match, evidence: EVIDENCE })
    expect(record.verdict).toBe('agree')
    expect(record.note).toContain('句间多出 1 段文字（共 28 字')
  })

  it('句中多出的成段文字照常计入距离', () => {
    const source = '太阳病发热汗出恶风桂枝三两芍药三两甘草二两炙生姜三两切大枣十二枚擘脉缓者名为中风也。'
    const { match } = collateOne(source, 'jobkoko', '太阳病，发热汗出恶风，脉缓者，名为中风也。')
    expect(match.structuralGaps).toBe(0)
    expect(['mismatch', 'missing']).toContain(verdictOf(match))
  })

  it('远离前一可靠段的弱命中段降级为未命中', () => {
    const needle = prepareCollationNeedle('一二三四五六七八九十甲乙丙丁戊己庚辛壬癸')
    const piece = (needleStart: number, pointStart: number, ratio: number): PieceMatch => ({
      needleStart,
      needleEnd: needleStart + 10,
      sentenceEnd: true,
      pointStart,
      pointEnd: pointStart + 10,
      distance: Math.round((1 - ratio) * 10),
      plainDistance: Math.round((1 - ratio) * 10),
      spanLength: 10,
      ratio,
      bestRatio: ratio,
    })
    const far = demoteStrayPieces(needle, [piece(0, 0, 1), piece(10, 500, 0.6)], 64)
    expect(far[1]!.pointStart).toBeNull()
    expect(far[1]!.distance).toBe(10)
    const near = demoteStrayPieces(needle, [piece(0, 0, 1), piece(10, 12, 0.6)], 64)
    expect(near[1]!.pointStart).toBe(12)
  })

  it('容差内倒退的分段取并集区间，不产生空区间', () => {
    const needle = prepareCollationNeedle('一二三四五六七八九十甲乙丙丁戊己庚辛壬癸')
    const haystack = prepareCollationHaystack('子'.repeat(40), 'jobkoko')
    const piece = (needleStart: number, pointStart: number): PieceMatch => ({
      needleStart,
      needleEnd: needleStart + 10,
      sentenceEnd: true,
      pointStart,
      pointEnd: pointStart + 10,
      distance: 0,
      plainDistance: 0,
      spanLength: 10,
      ratio: 1,
      bestRatio: 1,
    })
    const match = aggregatePieces(needle, haystack, [piece(0, 20), piece(10, 5)])
    expect(match.outOfOrder).toBe(false)
    expect([match.pointStart, match.pointEnd]).toEqual([5, 30])
    expect(match.end).toBeGreaterThan(match.start)
  })
})

describe('记录生成与 verdict 边界', () => {
  it('classifyCollationRatio 边界', () => {
    expect(classifyCollationRatio(1)).toBe('agree')
    expect(classifyCollationRatio(0.95)).toBe('agree')
    expect(classifyCollationRatio(0.949)).toBe('variant')
    expect(classifyCollationRatio(0.8)).toBe('variant')
    expect(classifyCollationRatio(0.799)).toBe('mismatch')
    expect(classifyCollationRatio(MISSING_RATIO_FLOOR)).toBe('mismatch')
    expect(classifyCollationRatio(MISSING_RATIO_FLOOR - 0.001)).toBe('missing')
  })

  it('variants 只在 variant 时写入', () => {
    const needle = prepareCollationNeedle('桂枝汤主之')
    const variants = [{ op: 'replace' as const, local: '桂', witness: '肉' }]
    const variantRecord = buildCollationRecord({ entityId: 'v', needle, match: fakeMatch(0.9), evidence: EVIDENCE, variants })
    expect(variantRecord.verdict).toBe('variant')
    expect(variantRecord.ratio).toBe(0.9)
    expect(variantRecord.variants).toEqual(variants)
    const agreeRecord = buildCollationRecord({ entityId: 'a', needle, match: fakeMatch(0.97), evidence: EVIDENCE, variants })
    expect(agreeRecord.verdict).toBe('agree')
    expect(agreeRecord.variants).toBeUndefined()
    expect(agreeRecord).toMatchObject({ entityType: 'clause', field: 'text', evidence: EVIDENCE })
  })

  it('最佳候选低于下限或未命中均为 missing，且不写 ratio', () => {
    const needle = prepareCollationNeedle('桂枝汤主之其人必自愈也')
    const low = buildCollationRecord({ entityId: 'l', needle, match: fakeMatch(0.3), evidence: EVIDENCE })
    expect(low.verdict).toBe('missing')
    expect(low.ratio).toBeUndefined()
    expect(low.note).toContain('按 missing 处理')
    const none = buildCollationRecord({ entityId: 'n', needle, match: fakeMatch(0, false), evidence: EVIDENCE })
    expect(none.verdict).toBe('missing')
    expect(none.ratio).toBeUndefined()
  })

  it('differentRecension 写入 note', () => {
    const needle = prepareCollationNeedle('桂枝汤主之')
    const record = buildCollationRecord({ entityId: 'r', needle, match: fakeMatch(0.9), evidence: EVIDENCE, differentRecension: true })
    expect(record.note).toContain('不同版本系统')
  })

  it('异文片段可拼回两侧原文，并产出替换字对', () => {
    const source = '太阳病，发热汗出，恶风，脉缓者，名为中风。'
    const text = '太阳病，发热汗出，恶寒，脉缓者，名曰中风。'
    const { haystack, needle, match } = collateOne(source, 'jobkoko', text)
    expect(verdictOf(match)).toBe('variant')
    const runs = clauseDiffRuns(needle, haystack, match)
    const segments = buildVariantSegments(needle, haystack, match, runs)
    expect(segments.map((segment) => segment.local).join('')).toBe(text)
    expect(segments.map((segment) => segment.witness).join('')).toBe(source.slice(match.start, match.end))
    expect(segments.filter((segment) => segment.op === 'replace').map((segment) => segment.local.replace(/[，。]/g, ''))).toEqual([
      '寒',
      '曰',
    ])
    expect(collectReplacePairs(needle, haystack, runs)).toEqual([
      { local: '寒', witness: '风' },
      { local: '曰', witness: '为' },
    ])
  })

  it('Kanripo 缺字参与比对：通配命中计数且 plainRatio 更低', () => {
    const source = '生薑四片大&KR0037;一枚水盞半煎八分去滓溫服'
    const { haystack, needle, match } = collateOne(source, 'kanripo', '生姜四片，大枣一枚，水盏半，煎八分，去滓温服。')
    expect(match.found).toBe(true)
    expect(match.ratio).toBe(1)
    expect(match.plainRatio).toBeLessThan(match.ratio)
    expect(countGapMatches(needle, haystack, clauseDiffRuns(needle, haystack, match))).toBe(1)
  })
})

describe('汇总统计', () => {
  it('tallyVerdicts 计数、比例与平均 ratio（不含 missing）', () => {
    const tally = tallyVerdicts([
      { verdict: 'agree', ratio: 1 },
      { verdict: 'variant', ratio: 0.9 },
      { verdict: 'mismatch', ratio: 0.6 },
      { verdict: 'missing' },
    ])
    expect(tally).toMatchObject({ total: 4, agree: 1, variant: 1, mismatch: 1, missing: 1 })
    expect(tally.rates).toEqual({ agree: 0.25, variant: 0.25, mismatch: 0.25, missing: 0.25 })
    expect(tally.averageRatio).toBe(0.8333)
  })

  it('tallyVerdicts 空输入与非法 verdict', () => {
    expect(tallyVerdicts([])).toMatchObject({ total: 0, averageRatio: null, rates: { agree: 0, variant: 0, mismatch: 0, missing: 0 } })
    expect(() => tallyVerdicts([{ verdict: 'bad' as 'agree' }])).toThrow(/未知 verdict/)
  })

  it('字对按次数降序、码元序升序排列，书目去重排序', () => {
    const ranked = rankReplacePairs(
      [
        { local: '已', witness: '巳', bookId: 'jingui', entityId: 'jingui-2' },
        { local: '阴', witness: '隂', bookId: 'songben', entityId: 'songben-9' },
        { local: '已', witness: '巳', bookId: 'piwei', entityId: 'piwei-1' },
        { local: '阴', witness: '隂', bookId: 'jingui', entityId: 'jingui-1' },
        { local: '阴', witness: '隂', bookId: 'jingui', entityId: 'jingui-3' },
        { local: '谷', witness: '榖', bookId: 'piwei', entityId: 'piwei-2' },
      ],
      2,
    )
    expect(ranked).toEqual([
      { local: '阴', witness: '隂', count: 3, books: ['jingui', 'songben'], example: 'jingui-1' },
      { local: '已', witness: '巳', count: 2, books: ['jingui', 'piwei'], example: 'jingui-2' },
    ])
  })

  it('mergeRankedPairs 合并多份排名并累加次数', () => {
    const first: RankedPair[] = [{ local: '阴', witness: '隂', count: 2, books: ['a'], example: 'a-2' }]
    const second: RankedPair[] = [
      { local: '阴', witness: '隂', count: 1, books: ['b'], example: 'b-1' },
      { local: '谷', witness: '榖', count: 3, books: ['b'], example: 'b-5' },
    ]
    const merged = mergeRankedPairs([first, second], 10)
    expect(merged.map((pair) => [pair.local, pair.count])).toEqual([
      ['谷', 3],
      ['阴', 3],
    ])
    expect(merged[1]!.books).toEqual(['a', 'b'])
    expect(merged[1]!.example).toBe('a-2')
  })

  it('chapterHotspots 只返回异常比例与条数都达标的篇章', () => {
    const items = [
      ...Array.from({ length: 4 }, () => ({ chapter: '卷一', verdict: 'missing' as const })),
      { chapter: '卷一', verdict: 'agree' as const },
      ...Array.from({ length: 2 }, () => ({ chapter: '卷二', verdict: 'mismatch' as const })),
      ...Array.from({ length: 5 }, () => ({ chapter: '卷三', verdict: 'mismatch' as const })),
      ...Array.from({ length: 5 }, () => ({ chapter: '卷三', verdict: 'agree' as const })),
    ]
    expect(chapterHotspots(items)).toEqual([{ chapter: '卷一', total: 5, anomalies: 4, rate: 0.8 }])
    expect(chapterHotspots(items, { minRate: 0.5, minCount: 2 }).map((hotspot) => hotspot.chapter)).toEqual(['卷三', '卷一', '卷二'])
  })

  it('evenlySample 确定性等距抽样', () => {
    const items = Array.from({ length: 10 }, (_, index) => index)
    expect(evenlySample(items, 5)).toEqual([0, 2, 4, 6, 8])
    expect(evenlySample(items, 20)).toEqual(items)
    expect(evenlySample(items, 0)).toEqual([])
    expect(evenlySample([], 3)).toEqual([])
  })
})
