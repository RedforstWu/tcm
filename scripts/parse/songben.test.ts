import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyErrata, defaultErrataPath } from '../lib/errata.ts'
import { normalizeForCompare } from '../lib/wiki.ts'
import {
  SONGBEN_BOOK_ID,
  SONGBEN_CLAUSE_COUNT,
  assertSongbenClauseCount,
  isFormulaAppendixText,
  parseSongbenWiki,
  resolveFormulaHeading,
} from './songben.ts'

const RAW_PATH = path.resolve(import.meta.dirname, '../../data/raw/songben-shanghan.wiki')
const ERRATA_PATH = defaultErrataPath(SONGBEN_BOOK_ID)
const KB_CLAUSE_DIR = path.resolve(
  import.meta.dirname,
  '../../data/vendor/shanghan-lun-knowledge-base/伤寒论知识库/01_条文',
)

const PIG_BILE_PREPARATION = '大猪胆一枚，泻汁，和少许法醋，以灌谷道内。如一食顷，当大便出宿食恶物，甚效。'
const SHAOKUN_PREPARATION = '妇人中裈近隐处，取烧作灰。'

describe('songben parser', () => {
  it('parses 398 clauses and includes guizhi tang 5 herbs', () => {
    const parsed = parseSongbenWiki(readFileSync(RAW_PATH, 'utf8'))
    expect(parsed.clauses.length).toBe(SONGBEN_CLAUSE_COUNT)
    const guizhi = parsed.formulas.find((formula) => formula.name === '桂枝汤')
    expect(guizhi).toBeTruthy()
    expect(guizhi!.herbs.map((herb) => herb.name).sort()).toEqual(
      ['大枣', '桂枝', '甘草', '生姜', '芍药'].sort(),
    )
  })

  it('merges formula preparation fragments instead of numbering them as clauses', () => {
    const parsed = parseSongbenWiki(readFileSync(RAW_PATH, 'utf8'))
    expect(parsed.clauses.map((clause) => clause.order)).toEqual(
      Array.from({ length: SONGBEN_CLAUSE_COUNT }, (_, index) => index + 1),
    )
    expect(parsed.clauses.some((clause) => clause.text === PIG_BILE_PREPARATION)).toBe(false)
    expect(parsed.clauses.some((clause) => clause.text === SHAOKUN_PREPARATION)).toBe(false)
    expect(parsed.clauses[233]!.text).toBe('阳明病，脉迟，汗出多，微恶寒者，表未解也，可发汗，宜桂枝汤。')
    expect(parsed.clauses[391]!.text.startsWith('伤寒阴阳易之为病')).toBe(true)

    expect(parsed.formulaAppendices).toEqual([
      {
        ownerClauseId: 'songben-233',
        formulaName: '猪胆汁',
        formulaId: 'songben-formula-猪胆汁',
        text: PIG_BILE_PREPARATION,
      },
      {
        ownerClauseId: 'songben-392',
        formulaName: '烧裈散',
        formulaId: 'songben-formula-烧裈散',
        text: SHAOKUN_PREPARATION,
      },
    ])
    const shaokun = parsed.formulas.find((formula) => formula.name === '烧裈散')
    expect(shaokun?.preparation.startsWith(SHAOKUN_PREPARATION)).toBe(true)
    expect(shaokun?.preparation).toContain('上一味，水服方寸匕')
    expect(shaokun?.sourceClauseIds).toEqual(['songben-392'])
  })

  it('models 233 appendix formulas (蜜煎导 / 土瓜根 / 猪胆汁) and 烧裈散 herb', () => {
    const parsed = parseSongbenWiki(readFileSync(RAW_PATH, 'utf8'))
    const byName = new Map(parsed.formulas.map((formula) => [formula.name, formula]))

    const pigBile = byName.get('猪胆汁')
    expect(pigBile?.herbs.map((herb) => herb.name)).toEqual(['大猪胆'])
    expect(pigBile?.herbs[0]).toMatchObject({ doseRaw: '一枚', processing: '泻汁' })
    expect(pigBile?.preparation).toBe(PIG_BILE_PREPARATION)
    expect(pigBile?.preparation).toContain('和少许法醋，以灌谷道内')

    const honey = byName.get('蜜煎导')
    expect(honey?.herbs.map((herb) => `${herb.name}:${herb.doseRaw}`)).toEqual(['食蜜:七合'])
    expect(honey?.preparation.startsWith('上一味。于铜器内')).toBe(true)

    const tuguagen = byName.get('土瓜根')
    expect(tuguagen?.herbs).toEqual([])
    expect(tuguagen?.preparation).toBe('')
    expect(parsed.formulaNotes).toEqual([
      expect.objectContaining({ formulaId: 'songben-formula-土瓜根', note: expect.stringContaining('原方佚') }),
    ])

    for (const formula of [pigBile, honey, tuguagen]) {
      expect(formula?.sourceClauseIds).toEqual(['songben-233'])
      expect(parsed.clauses[232]!.formulaIds).toContain(formula?.id)
    }

    const shaokun = byName.get('烧裈散')
    expect(shaokun?.herbs).toEqual([
      expect.objectContaining({ name: '妇人中裈', doseRaw: '', processing: '近隐处，取烧作灰' }),
    ])
  })

  it('links a heading to its preceding clause only when the clause names the formula (synthetic wiki)', () => {
    const raw = [
      '=== 辨阳明病脉证并治 ===',
      '阳明病，自汗出，宜蜜煎导而通之，若土瓜根及大猪胆汁，皆可为导。',
      ':;蜜煎导方',
      '::食蜜七合',
      '::上一味。于铜器内，微火煎。',
      '阳明病，脉迟，汗出多，微恶寒者，表未解也，可发汗。',
      ':;土瓜根方（附方佚）',
    ].join('\n')
    const parsed = parseSongbenWiki(raw, { expectedClauseCount: null })
    const byName = new Map(parsed.formulas.map((formula) => [formula.name, formula]))
    expect(byName.get('蜜煎导')?.sourceClauseIds).toEqual(['songben-1'])
    // 前一条文未提土瓜根，不挂靠
    expect(byName.get('土瓜根')?.sourceClauseIds).toEqual([])
    expect(byName.get('土瓜根')?.herbs).toEqual([])
  })

  it('content rule never fires on a real clause', () => {
    const parsed = parseSongbenWiki(readFileSync(RAW_PATH, 'utf8'))
    expect(parsed.clauses.filter((clause) => isFormulaAppendixText(clause.text))).toEqual([])
  })
})

describe('formula appendix detection', () => {
  it('recognizes known preparation fragments (simplified and traditional)', () => {
    expect(isFormulaAppendixText(PIG_BILE_PREPARATION)).toBe(true)
    expect(isFormulaAppendixText(SHAOKUN_PREPARATION)).toBe(true)
    expect(isFormulaAppendixText('大豬膽一枚，瀉汁，和少許法醋，以灌穀道內。')).toBe(true)
  })

  it('rejects normal clauses', () => {
    expect(isFormulaAppendixText('阳明病，脉迟，汗出多，微恶寒者，表未解也，可发汗，宜桂枝汤。')).toBe(false)
    expect(isFormulaAppendixText('大病差后，劳复者，枳实栀子豉汤主之。')).toBe(false)
    expect(isFormulaAppendixText('吐利，发汗，脉平，小烦者，以新虚不胜谷气故也。')).toBe(false)
    expect(isFormulaAppendixText('')).toBe(false)
  })

  it('resolves formula headings including annotated ones', () => {
    expect(resolveFormulaHeading('烧裈散方')).toBe('烧裈散')
    expect(resolveFormulaHeading('猪胆汁方（附方）')).toBe('猪胆汁')
    expect(resolveFormulaHeading('土瓜根方（附方佚）')).toBe('土瓜根')
    expect(resolveFormulaHeading('蜜煎导方')).toBe('蜜煎导')
    expect(resolveFormulaHeading('大病差后，劳复者，枳实栀子豉汤主之。')).toBeNull()
  })

  it('only merges inside a formula section (synthetic wiki)', () => {
    const raw = [
      '=== 辨阴阳易差后劳复病脉证并治第十四 ===',
      '伤寒阴阳易之为病，身体重，烧裈散主之。',
      ':;烧裈散方',
      '::妇人中裈近隐处，取烧作灰。',
      '::上一味，水服方寸匕。日三服。',
      '大病差后，劳复者，枳实栀子豉汤主之。',
      '妇人中裈近隐处，取烧作灰。',
    ].join('\n')
    const parsed = parseSongbenWiki(raw, { expectedClauseCount: null })
    // 区段外的同文行按条文处理，证明并入依赖上下文而非写死文本
    expect(parsed.clauses.map((clause) => clause.text)).toEqual([
      '伤寒阴阳易之为病，身体重，烧裈散主之。',
      '大病差后，劳复者，枳实栀子豉汤主之。',
      '妇人中裈近隐处，取烧作灰。',
    ])
    expect(parsed.formulaAppendices).toHaveLength(1)
    expect(parsed.formulaAppendices[0]!.ownerClauseId).toBe('songben-1')
    const shaokun = parsed.formulas.find((formula) => formula.name === '烧裈散')
    expect(shaokun?.preparation).toBe('妇人中裈近隐处，取烧作灰。上一味，水服方寸匕。日三服。')
  })
})

function parseSynthetic(lines: string[]) {
  return parseSongbenWiki(lines.join('\n'), { expectedClauseCount: null })
}

/** 方剂区段置于篇首，避免「小标题前一条文」挂靠干扰关联断言 */
function formulaSection(name: string, herbs: string): string[] {
  return [`:;${name}方`, `::${herbs}`, '::上二味，以水三升，煮取一升，去滓，顿服。']
}

function linkedNames(parsed: ReturnType<typeof parseSongbenWiki>): string[][] {
  return parsed.clauses.map((clause) => clause.formulaIds.map((id) => id.replace('songben-formula-', '')))
}

describe('clause → formula linking (synthetic wiki)', () => {
  it('resolves bare 柴胡汤 to 小柴胡汤 unless a full 柴胡-family name appears', () => {
    const parsed = parseSynthetic([
      '=== 辨太阳病脉证并治中 ===',
      ...formulaSection('小柴胡汤', '柴胡半斤　黄芩三两'),
      ...formulaSection('大柴胡汤', '柴胡半斤　枳实四枚'),
      '伤寒五六日，呕而发热者，柴胡汤证具，而以他药下之，柴胡证仍在者，复与柴胡汤。',
      '太阳病，过经十余日，呕不止，与大柴胡汤下之则愈；若不差，复与柴胡汤。',
      '得病六七日，小便难者，与柴胡汤，后必下重。',
    ])
    expect(linkedNames(parsed)).toEqual([['小柴胡汤'], ['大柴胡汤'], ['小柴胡汤']])
  })

  it('maps the 栀子柏皮汤 variant to the 栀子檗皮汤 heading', () => {
    const parsed = parseSynthetic([
      '=== 辨阳明病脉证并治 ===',
      ...formulaSection('栀子檗皮汤', '肥栀子十五个　甘草一两'),
      '伤寒，身黄，发热，栀子柏皮汤主之。',
    ])
    expect(linkedNames(parsed)).toEqual([['栀子檗皮汤']])
  })

  it('links prescription phrasing but keeps negation within the same segment', () => {
    const parsed = parseSynthetic([
      '=== 辨太阳病脉证并治中 ===',
      ...formulaSection('麻黄汤', '麻黄三两　杏仁七十个'),
      ...formulaSection('茯苓甘草汤', '茯苓二两　甘草一两'),
      ...formulaSection('大青龙汤', '麻黄六两　石膏如鸡子大'),
      ...formulaSection('桂枝汤', '桂枝三两　芍药三两'),
      ...formulaSection('芍药甘草汤', '芍药四两　甘草四两'),
      '太阳与阳明合病，喘而胸满者，不可下，宜麻黄汤。',
      '伤寒，厥而心下悸，宜先治水，当服茯苓甘草汤，却治其厥。',
      '伤寒脉浮缓，无少阴证者，大青龙汤发之。',
      '若厥愈足温者，更作芍药甘草汤与之，其脚即伸。',
      '喘家作，桂枝汤加厚朴、杏子佳。',
      '发汗后，不可更行桂枝汤，汗出而喘，无大热者，可与麻黄汤。',
    ])
    expect(linkedNames(parsed)).toEqual([
      ['麻黄汤'],
      ['茯苓甘草汤'],
      ['大青龙汤'],
      ['芍药甘草汤'],
      ['桂枝汤'],
      ['麻黄汤'],
    ])
  })
})

describe.skipIf(!existsSync(ERRATA_PATH))('songben wiki with errata applied', () => {
  const raw = readFileSync(RAW_PATH, 'utf8')
  const corrected = applyErrata(raw, JSON.parse(readFileSync(ERRATA_PATH, 'utf8')))
  const parsed = parseSongbenWiki(corrected.text)
  const clauseFormulaIds = (clauseNumber: number) => parsed.clauses[clauseNumber - 1]!.formulaIds
  const formulaByName = new Map(parsed.formulas.map((formula) => [formula.name, formula]))

  it('keeps 398 clauses with identical ids and texts', () => {
    const uncorrected = parseSongbenWiki(raw)
    expect(parsed.clauses).toHaveLength(SONGBEN_CLAUSE_COUNT)
    expect(parsed.clauses.map((clause) => [clause.id, clause.text])).toEqual(
      uncorrected.clauses.map((clause) => [clause.id, clause.text]),
    )
  })

  it('restores the 吴茱萸汤 heading and links clauses 243 / 309 / 378', () => {
    const wuzhuyu = formulaByName.get('吴茱萸汤')
    expect(wuzhuyu?.id).toBe('songben-formula-吴茱萸汤')
    expect(wuzhuyu?.herbs.map((herb) => `${herb.name}${herb.doseRaw}`)).toEqual([
      '吴茱萸一升',
      '人参三两',
      '生姜六两',
      '大枣十二枚',
    ])
    expect(wuzhuyu?.sourceClauseIds).toEqual(['songben-243', 'songben-309', 'songben-378'])
    expect(parsed.formulas.some((formula) => formula.herbs.some((herb) => herb.name.includes('四逆散')))).toBe(false)
  })

  it('applies dose and heading corrections', () => {
    const doseOf = (formulaName: string, herbName: string) =>
      formulaByName.get(formulaName)?.herbs.find((herb) => herb.name === herbName)?.doseRaw
    expect(doseOf('桂枝加桂汤', '桂枝')).toBe('五两')
    expect(doseOf('黄芩汤', '大枣')).toBe('十二枚')
    expect(doseOf('竹叶石膏汤', '半夏')).toBe('半升')
    expect(doseOf('附子泻心汤', '附子')).toBe('一枚')
    expect(formulaByName.has('桂技甘草汤')).toBe(false)
    expect(formulaByName.get('桂枝甘草汤')?.sourceClauseIds).toEqual(['songben-64'])
  })

  it('fills the 本地漏 clause → formula links from the KB crosscheck', () => {
    const expectedLinks: Array<[number, string]> = [
      [18, '桂枝汤'],
      [29, '芍药甘草汤'],
      [36, '麻黄汤'],
      [39, '大青龙汤'],
      [64, '桂枝甘草汤'],
      [98, '小柴胡汤'],
      [101, '小柴胡汤'],
      [104, '小柴胡汤'],
      [141, '三物小白散'],
      [141, '小陷胸汤'],
      [149, '小柴胡汤'],
      [162, '麻黄杏仁甘草石膏汤'],
      [243, '吴茱萸汤'],
      [251, '小承气汤'],
      [261, '栀子檗皮汤'],
      [309, '吴茱萸汤'],
      [356, '茯苓甘草汤'],
      [378, '吴茱萸汤'],
    ]
    const missing = expectedLinks.filter(
      ([clauseNumber, formulaName]) => !clauseFormulaIds(clauseNumber).includes(`songben-formula-${formulaName}`),
    )
    expect(missing).toEqual([])
    // 第 156 条「与泻心汤」泛指，本书无同名方，不猜测
    expect(clauseFormulaIds(156)).toEqual(['songben-formula-五苓散'])
    // 第 103 条已有大柴胡汤全称：不因「柴胡」误增
    expect(clauseFormulaIds(103)).toEqual(['songben-formula-小柴胡汤', 'songben-formula-大柴胡汤'])
  })

  it('does not add links in non-prescribing or prohibitive contexts', () => {
    const guizhi = 'songben-formula-桂枝汤'
    for (const clauseNumber of [19, 26, 28, 63, 162]) {
      expect(clauseFormulaIds(clauseNumber)).not.toContain(guizhi)
    }
    // 第 251 条「与承气汤一升」未指明大小，不解析
    expect([...clauseFormulaIds(251)].sort()).toEqual(['songben-formula-大承气汤', 'songben-formula-小承气汤'])
  })
})

describe('clause count assertion', () => {
  it('throws when count differs from 398', () => {
    expect(() => assertSongbenClauseCount(SONGBEN_CLAUSE_COUNT)).not.toThrow()
    expect(() => assertSongbenClauseCount(400)).toThrow(/400/)
    expect(() => parseSongbenWiki('=== 辨太阳病脉证并治上 ===\n太阳病，发热，汗出，恶风，脉缓者，名为中风。')).toThrow(
      /398/,
    )
  })
})

/** KB 字形现代化，比对前折叠常见异体 */
const KB_GLYPH_FOLDS: Array<[RegExp, string]> = [
  [/鞕/g, '硬'],
  [/蚘/g, '蛔'],
  [/矢气/g, '失气'],
]
const LOW_SIMILARITY_THRESHOLD = 0.8
/** 已核实的 KB 侧小字注 / 异文差异：57、84、86、180 */
const MAX_LOW_SIMILARITY_CLAUSES = 4

function foldForCompare(text: string): string {
  let folded = normalizeForCompare(text)
  for (const [pattern, replacement] of KB_GLYPH_FOLDS) folded = folded.replace(pattern, replacement)
  return folded
}

function bigramDice(left: string, right: string): number {
  const count = (text: string) => {
    const grams = new Map<string, number>()
    for (let index = 0; index < text.length - 1; index += 1) {
      const gram = text.slice(index, index + 2)
      grams.set(gram, (grams.get(gram) ?? 0) + 1)
    }
    return grams
  }
  const leftGrams = count(left)
  const rightGrams = count(right)
  let total = 0
  let shared = 0
  for (const value of leftGrams.values()) total += value
  for (const value of rightGrams.values()) total += value
  for (const [gram, value] of leftGrams) shared += Math.min(value, rightGrams.get(gram) ?? 0)
  return total === 0 ? 0 : (2 * shared) / total
}

function loadKbClauses(): Map<number, string> {
  const byNumber = new Map<number, string>()
  for (const channelDir of readdirSync(KB_CLAUSE_DIR)) {
    const dirPath = path.join(KB_CLAUSE_DIR, channelDir)
    if (!statSync(dirPath).isDirectory()) continue
    for (const fileName of readdirSync(dirPath)) {
      if (!/^条文-\d+\.md$/.test(fileName)) continue
      const markdown = readFileSync(path.join(dirPath, fileName), 'utf8')
      const clauseNumber = Number(markdown.match(/^条文号:\s*(\d+)/m)?.[1])
      const section = markdown.split(/^## 原文（宋版）\s*$/m)[1] ?? ''
      const original = (section.split(/^## /m)[0] ?? '')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('>'))
        .map((line) => line.replace(/^>\s?/, ''))
        .join('')
      if (Number.isInteger(clauseNumber) && original) byNumber.set(clauseNumber, original)
    }
  }
  return byNumber
}

describe.skipIf(!existsSync(KB_CLAUSE_DIR))('numbering vs shanghan-lun-knowledge-base', () => {
  it('aligns every clause with the same KB number', () => {
    const kb = loadKbClauses()
    expect(kb.size).toBe(SONGBEN_CLAUSE_COUNT)
    const parsed = parseSongbenWiki(readFileSync(RAW_PATH, 'utf8'))
    const kbText = (clauseNumber: number) => foldForCompare(kb.get(clauseNumber) ?? '')

    const lowSimilarity: Array<{ order: number; score: number }> = []
    const misaligned: number[] = []
    for (const clause of parsed.clauses) {
      const text = foldForCompare(clause.text)
      const score = bigramDice(text, kbText(clause.order))
      if (score < LOW_SIMILARITY_THRESHOLD) lowSimilarity.push({ order: clause.order, score })
      // 相邻编号得分更高即视为错位
      for (const neighbor of [clause.order - 1, clause.order + 1]) {
        if (kb.has(neighbor) && bigramDice(text, kbText(neighbor)) > score) misaligned.push(clause.order)
      }
    }
    if (lowSimilarity.length > 0) console.info('[songben vs KB] 相似度 < 0.8：', lowSimilarity)
    expect(misaligned).toEqual([])
    expect(lowSimilarity.length).toBeLessThanOrEqual(MAX_LOW_SIMILARITY_CLAUSES)
  })
})
