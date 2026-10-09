import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Clause, Evidence, Formula, FormulaHerb, SourceGroup } from '../../src/types/data.ts'
import type {
  EntityEvidenceRecord,
  EvidenceFile,
  EvidenceVerdict,
  IntegratedSyndrome,
} from './integration-contract.ts'
import {
  DEFAULT_PUBLISH_GATE,
  applyIntegrationToClauses,
  applyIntegrationToFormulas,
  backfillFormulaHerbs,
  classifyFieldLevel,
  countEvidenceLevelsByBook,
  entityEvidenceLevel,
  gateClauseAttributes,
  isAdvisoryMismatch,
  gateCommentaries,
  gateEvidence,
  gateSyndromes,
  hasResolvableComposition,
  isResolvableDonorHerbList,
  loadIntegrationInputs,
  mergeEvidenceFiles,
  mergeSyndromeConcepts,
  recordToEvidence,
  resolvePublishGate,
  syndromeToConcept,
  type HerbBackfillPolicy,
  type PublishGate,
} from './integration-merge.ts'

const PUBLISH_GATE: PublishGate = { publishUnlicensed: true }

const SOURCE_BY_GROUP: Record<SourceGroup, { sourceId: string; license: string }> = {
  wikisource: { sourceId: 'wikisource:songben', license: 'CC BY-SA 4.0' },
  kanripo: { sourceId: 'kanripo:KR3e0007@SBCK', license: 'CC BY-SA 4.0' },
  'web-simplified': { sourceId: 'jobkoko@abc', license: '未声明' },
  derived: { sourceId: 'shanghan-kb@def', license: '未声明' },
}

function evidenceOf(group: SourceGroup, extra: Partial<Evidence> = {}): Evidence {
  return { ...SOURCE_BY_GROUP[group], group, locator: `${group}-loc`, ...extra }
}

function record(
  group: SourceGroup,
  verdict: EvidenceVerdict,
  overrides: Partial<EntityEvidenceRecord> = {},
): EntityEvidenceRecord {
  return {
    entityId: 'songben-12',
    entityType: 'clause',
    field: 'text',
    verdict,
    evidence: evidenceOf(group),
    ...overrides,
  }
}

function evidenceFile(records: unknown[]): EvidenceFile {
  return {
    producer: 'test',
    generatedAt: '2026-10-09T00:00:00.000Z',
    sourceIds: [],
    records: records as EntityEvidenceRecord[],
  }
}

describe('classifyFieldLevel', () => {
  it('无记录或只有 missing 时为 single（见证本缺段不构成反证）', () => {
    expect(classifyFieldLevel([])).toBe('single')
    expect(classifyFieldLevel([record('kanripo', 'missing'), record('derived', 'missing')])).toBe('single')
  })

  it('kanripo 一致即互证；variant 视同一致', () => {
    expect(classifyFieldLevel([record('kanripo', 'agree')])).toBe('corroborated')
    expect(classifyFieldLevel([record('kanripo', 'variant')])).toBe('corroborated')
  })

  it('仅 derived 与/或 web-simplified 一致也判互证：每条记录本身已是 wikisource 基准 + 见证组两组一致', () => {
    expect(classifyFieldLevel([record('derived', 'agree')])).toBe('corroborated')
    expect(classifyFieldLevel([record('web-simplified', 'variant')])).toBe('corroborated')
    expect(classifyFieldLevel([record('derived', 'agree'), record('web-simplified', 'agree')])).toBe(
      'corroborated',
    )
  })

  it('wikisource 组自身的记录不计入他组', () => {
    expect(classifyFieldLevel([record('wikisource', 'agree')])).toBe('single')
    expect(classifyFieldLevel([record('wikisource', 'mismatch')])).toBe('single')
  })

  it('kanripo mismatch 时他组一致也判 disputed', () => {
    expect(classifyFieldLevel([record('kanripo', 'mismatch'), record('derived', 'agree')])).toBe('disputed')
    expect(
      classifyFieldLevel([
        record('kanripo', 'mismatch'),
        record('web-simplified', 'agree'),
        record('derived', 'agree'),
      ]),
    ).toBe('disputed')
  })

  it('只有 mismatch 没有一致 → disputed；非 kanripo 的 mismatch 被他组一致压过 → corroborated', () => {
    expect(classifyFieldLevel([record('derived', 'mismatch')])).toBe('disputed')
    expect(classifyFieldLevel([record('derived', 'mismatch'), record('kanripo', 'missing')])).toBe('disputed')
    expect(classifyFieldLevel([record('derived', 'mismatch'), record('kanripo', 'agree')])).toBe('corroborated')
  })

  it('missing 不抵消 mismatch，也不提供一致', () => {
    expect(classifyFieldLevel([record('kanripo', 'missing'), record('web-simplified', 'mismatch')])).toBe(
      'disputed',
    )
  })

  it('derived 的煎服法 mismatch 只供审阅，不参与判级；其他字段、其他组的 mismatch 照常判级', () => {
    const derivedPreparationMismatch = record('derived', 'mismatch', { entityType: 'formula', field: 'preparation' })
    expect(isAdvisoryMismatch(derivedPreparationMismatch)).toBe(true)
    expect(classifyFieldLevel([derivedPreparationMismatch])).toBe('single')
    expect(
      classifyFieldLevel([
        derivedPreparationMismatch,
        record('web-simplified', 'agree', { entityType: 'formula', field: 'preparation' }),
      ]),
    ).toBe('corroborated')
    expect(classifyFieldLevel([record('derived', 'mismatch', { entityType: 'formula', field: 'doses' })])).toBe(
      'disputed',
    )
    expect(
      classifyFieldLevel([record('kanripo', 'mismatch', { entityType: 'formula', field: 'preparation' })]),
    ).toBe('disputed')
    expect(isAdvisoryMismatch(record('derived', 'variant', { entityType: 'formula', field: 'preparation' }))).toBe(
      false,
    )
  })
})

describe('entityEvidenceLevel', () => {
  it('条文取 text 字段；无关键字段时为 undefined', () => {
    expect(entityEvidenceLevel('clause', { text: 'corroborated', formulaLink: 'disputed' })).toBe('corroborated')
    expect(entityEvidenceLevel('clause', { formulaLink: 'disputed' })).toBeUndefined()
  })

  it('方剂优先 herbs，其次 doses/preparation；任一关键字段 disputed 则 disputed', () => {
    expect(entityEvidenceLevel('formula', { herbs: 'single', doses: 'corroborated' })).toBe('single')
    expect(entityEvidenceLevel('formula', { doses: 'corroborated', preparation: 'single' })).toBe('corroborated')
    expect(entityEvidenceLevel('formula', { herbs: 'corroborated', preparation: 'disputed' })).toBe('disputed')
  })
})

describe('mergeEvidenceFiles', () => {
  it('按 (entityId, field) 聚合、去重并跳过非法记录', () => {
    const files = [
      evidenceFile([
        record('kanripo', 'agree'),
        record('kanripo', 'agree'),
        record('derived', 'agree', { entityId: 'jingui-formula-乌头汤', entityType: 'formula', field: 'herbs' }),
        record('kanripo', 'mismatch', {
          entityId: 'jingui-formula-乌头汤',
          entityType: 'formula',
          field: 'preparation',
        }),
        { entityId: 'songben-13', field: 'text' },
        record('kanripo', 'agree', { verdict: 'unknown' as EvidenceVerdict }),
      ]),
      evidenceFile([record('web-simplified', 'agree')]),
    ]
    const merged = mergeEvidenceFiles(files)
    expect(merged.recordCount).toBe(4)
    expect(merged.duplicateRecordCount).toBe(1)
    expect(merged.invalidRecordCount).toBe(2)
    const clause = merged.byEntity.get('songben-12')!
    expect(clause.records).toHaveLength(2)
    expect(clause.fieldLevels.text).toBe('corroborated')
    expect(clause.level).toBe('corroborated')
    const formula = merged.byEntity.get('jingui-formula-乌头汤')!
    expect(formula.fieldLevels).toEqual({ herbs: 'corroborated', preparation: 'disputed' })
    expect(formula.level).toBe('disputed')
  })
})

describe('许可闸门', () => {
  it('resolvePublishGate 只认 TCM_PUBLISH_UNLICENSED=1', () => {
    expect(resolvePublishGate({})).toEqual({ publishUnlicensed: false })
    expect(resolvePublishGate({ TCM_PUBLISH_UNLICENSED: 'true' })).toEqual({ publishUnlicensed: false })
    expect(resolvePublishGate({ TCM_PUBLISH_UNLICENSED: '1' })).toEqual({ publishUnlicensed: true })
  })

  it('默认去掉未授权组的 quote/variants/note，保留元数据；授权组与 flag 模式原样', () => {
    const unlicensed = evidenceOf('derived', {
      quote: '太阳中风',
      note: '注',
      verdict: 'variant',
      ratio: 0.9,
      variants: [{ op: 'replace', local: '啬', witness: '濇' }],
    })
    expect(gateEvidence(unlicensed, DEFAULT_PUBLISH_GATE)).toEqual({
      sourceId: 'shanghan-kb@def',
      group: 'derived',
      locator: 'derived-loc',
      license: '未声明',
      verdict: 'variant',
      ratio: 0.9,
    })
    expect(gateEvidence(unlicensed, PUBLISH_GATE)).toEqual(unlicensed)
    const licensed = evidenceOf('kanripo', { quote: '太阳中风' })
    expect(gateEvidence(licensed, DEFAULT_PUBLISH_GATE).quote).toBe('太阳中风')
  })

  it('recordToEvidence 带出 field/verdict/ratio，variants 仅 variant 且受闸门', () => {
    const variantRecord = record('web-simplified', 'variant', {
      ratio: 0.95,
      variants: [{ op: 'replace', local: '嗇', witness: '啬' }],
      evidence: evidenceOf('web-simplified', { quote: '原句' }),
    })
    const published = recordToEvidence(variantRecord, DEFAULT_PUBLISH_GATE)
    expect(published).toMatchObject({ field: 'text', verdict: 'variant', ratio: 0.95, group: 'web-simplified' })
    expect(published.quote).toBeUndefined()
    expect(published.variants).toBeUndefined()
    expect(recordToEvidence(variantRecord, PUBLISH_GATE).variants).toHaveLength(1)
    const kanripoVariant = record('kanripo', 'variant', { variants: [{ op: 'delete', local: '之', witness: '' }] })
    expect(recordToEvidence(kanripoVariant, DEFAULT_PUBLISH_GATE).variants).toHaveLength(1)
    const agreeWithVariants = record('kanripo', 'agree', { variants: [{ op: 'delete', local: '之', witness: '' }] })
    expect(recordToEvidence(agreeWithVariants, PUBLISH_GATE).variants).toBeUndefined()
  })

  const commentaries = [
    {
      id: 'commentary-尤怡-012',
      clauseId: 'songben-12',
      commentator: '尤怡',
      sourceBook: '伤寒贯珠集',
      formulaIds: ['songben-formula-桂枝汤'],
      summary: 'KB 现代转述',
      quotes: [
        { text: '此太阳中风之的脉的证也', verified: true, evidence: evidenceOf('web-simplified', { quote: 'x' }) },
        { text: '未核验句', verified: false },
      ],
      evidence: [evidenceOf('derived', { quote: 'KB 原文' })],
    },
    {
      id: 'commentary-柯琴-013',
      clauseId: 'songben-13',
      commentator: '柯琴',
      sourceBook: '伤寒来苏集',
      formulaIds: [],
      quotes: [{ text: '未核验句', verified: false }],
      evidence: [],
    },
    { id: 'bad' },
  ]

  it('注家默认只发布核验原句，无原句整条剔除，summary 永不发布', () => {
    const result = gateCommentaries(commentaries, DEFAULT_PUBLISH_GATE)
    expect(result.inputCount).toBe(3)
    expect(result.invalidCount).toBe(1)
    expect(result.validIds).toEqual(['commentary-尤怡-012', 'commentary-柯琴-013'])
    expect(result.droppedNoVerifiedQuote).toBe(1)
    expect(result.droppedUnverifiedQuotes).toBe(2)
    expect(result.commentaries).toHaveLength(1)
    const [published] = result.commentaries
    expect(published).not.toHaveProperty('summary')
    expect(published!.quotes).toEqual([
      {
        text: '此太阳中风之的脉的证也',
        verified: true,
        evidence: { sourceId: 'jobkoko@abc', group: 'web-simplified', locator: 'web-simplified-loc', license: '未声明' },
      },
    ])
    expect(published!.evidence[0]!.quote).toBeUndefined()
  })

  it('注家 flag 模式发布全部引文，但 summary 仍不发布', () => {
    const result = gateCommentaries(commentaries, PUBLISH_GATE)
    expect(result.commentaries).toHaveLength(2)
    expect(result.commentaries[0]!.quotes).toHaveLength(2)
    expect(result.commentaries[0]).not.toHaveProperty('summary')
    expect(result.commentaries[0]!.evidence[0]!.quote).toBe('KB 原文')
  })

  const syndromes: unknown[] = [
    {
      conceptId: 'syndrome.太阳中风证',
      prefLabel: '太阳中风证',
      sixChannel: '太阳病',
      clauseIds: ['songben-12'],
      mainFormulaIds: ['songben-formula-桂枝汤'],
      mainSymptoms: ['发热', '汗出'],
      differentials: [{ targetConceptId: 'syndrome.太阳伤寒证', note: '有汗无汗' }],
      definition: 'KB 定义',
      evidence: [evidenceOf('derived', { quote: 'KB' })],
    },
    { conceptId: '太阳伤寒证', prefLabel: '缺前缀' },
  ]

  it('证型默认整体不发布，flag 模式发布', () => {
    const closed = gateSyndromes(syndromes, DEFAULT_PUBLISH_GATE)
    expect(closed.syndromes).toEqual([])
    expect(closed.validIds).toEqual(['syndrome.太阳中风证'])
    expect(closed.invalidCount).toBe(1)
    const open = gateSyndromes(syndromes, PUBLISH_GATE)
    expect(open.syndromes).toHaveLength(1)
    expect(open.syndromes[0]!.definition).toBe('KB 定义')
  })

  it('syndromeToConcept：definition/鉴别要点受闸门，六经映射到已知 channel 概念', () => {
    const [syndrome] = gateSyndromes(syndromes, PUBLISH_GATE).syndromes as IntegratedSyndrome[]
    const open = syndromeToConcept(syndrome!, PUBLISH_GATE, new Map(), new Set(['channel.太阳']))
    expect(open).toMatchObject({
      id: 'syndrome.太阳中风证',
      type: 'syndrome',
      reviewStatus: 'ai-draft',
      sixChannel: '太阳病',
      broader: ['channel.太阳'],
      definition: 'KB 定义',
      evidenceLevel: 'single',
      differentials: [{ targetConceptId: 'syndrome.太阳伤寒证', note: '有汗无汗' }],
    })
    const closed = syndromeToConcept(syndrome!, DEFAULT_PUBLISH_GATE, new Map(), new Set())
    expect(closed.definition).toBeUndefined()
    expect(closed.broader).toBeUndefined()
    expect(closed.differentials).toEqual([{ targetConceptId: 'syndrome.太阳伤寒证' }])
    expect(closed.evidence![0]!.quote).toBeUndefined()
  })

  it('康平分层默认不发布，flag 模式发布并校验取值', () => {
    const file = {
      'songben-12': { kangpingLayer: '原文', evidence: [evidenceOf('derived')] },
      'songben-13': { kangpingLayer: '旁注', evidence: [] },
    }
    const closed = gateClauseAttributes(file, DEFAULT_PUBLISH_GATE)
    expect(closed.attributes).toEqual({})
    expect(closed.inputCount).toBe(2)
    expect(closed.invalidCount).toBe(1)
    const open = gateClauseAttributes(file, PUBLISH_GATE)
    expect(Object.keys(open.attributes)).toEqual(['songben-12'])
    expect(open.attributes['songben-12']!.kangpingLayer).toBe('原文')
    expect(gateClauseAttributes(null, PUBLISH_GATE).attributes).toEqual({})
  })
})

describe('写入实体', () => {
  const clause: Clause = {
    id: 'songben-12',
    book: 'songben',
    chapter: '辨太阳病脉证并治上',
    chapterOrder: 1,
    order: 12,
    text: '太阳中风……桂枝汤主之。',
    formulaIds: [],
    symptomTags: [],
    pulseTags: [],
    channelTags: [],
    pathogenesisTags: [],
    reviewStatus: 'ai-draft',
  }
  const untouched: Clause = { ...clause, id: 'songben-13', order: 13 }
  const formula: Formula = {
    id: 'songben-formula-桂枝汤',
    name: '桂枝汤',
    book: 'songben',
    herbs: [],
    preparation: '',
    modifications: [],
    sourceClauseIds: ['songben-12'],
  }

  it('条文写入 evidence/evidenceLevel/kangpingLayer，未命中的条文保持原对象', () => {
    const merged = mergeEvidenceFiles([
      evidenceFile([
        record('kanripo', 'agree', { evidence: evidenceOf('kanripo', { quote: '太阳中风' }) }),
        record('derived', 'agree', { evidence: evidenceOf('derived', { quote: 'KB 原文' }) }),
      ]),
    ]).byEntity
    const attributes = gateClauseAttributes(
      { 'songben-12': { kangpingLayer: '原文', evidence: [evidenceOf('derived', { locator: 'kp' })] } },
      PUBLISH_GATE,
    ).attributes
    const result = applyIntegrationToClauses([clause, untouched], merged, attributes, DEFAULT_PUBLISH_GATE)
    const [first, second] = result.items
    expect(second).toBe(untouched)
    expect([...result.matchedIds]).toEqual(['songben-12'])
    expect(first!.evidenceLevel).toBe('corroborated')
    expect(first!.kangpingLayer).toBe('原文')
    expect(first!.evidence).toHaveLength(3)
    expect(first!.evidence!.find((item) => item.group === 'kanripo')!.quote).toBe('太阳中风')
    expect(first!.evidence!.find((item) => item.group === 'derived' && item.field === 'text')!.quote).toBeUndefined()
  })

  it('方剂写入证据与判级', () => {
    const merged = mergeEvidenceFiles([
      evidenceFile([
        record('kanripo', 'mismatch', { entityId: formula.id, entityType: 'formula', field: 'herbs' }),
      ]),
    ]).byEntity
    const result = applyIntegrationToFormulas([formula], merged, DEFAULT_PUBLISH_GATE)
    expect(result.items[0]!.evidenceLevel).toBe('disputed')
    expect(result.items[0]!.evidence![0]).toMatchObject({ field: 'herbs', verdict: 'mismatch' })
  })

  it('证型概念与词表冲突时保留词表；按书计数含未比对', () => {
    const lexicon = [{ id: 'syndrome.x', type: 'syndrome' as const, prefLabel: 'x', altLabels: [], reviewStatus: 'reviewed' as const }]
    const merged = mergeSyndromeConcepts(lexicon, [
      { ...lexicon[0]!, reviewStatus: 'ai-draft' },
      { id: 'syndrome.y', type: 'syndrome', prefLabel: 'y', altLabels: [], reviewStatus: 'ai-draft' },
    ])
    expect(merged.conflictIds).toEqual(['syndrome.x'])
    expect(merged.concepts.map((item) => item.id)).toEqual(['syndrome.x', 'syndrome.y'])
    expect(merged.concepts[0]!.reviewStatus).toBe('reviewed')
    expect(
      countEvidenceLevelsByBook([
        { book: 'songben', evidenceLevel: 'corroborated' },
        { book: 'songben' },
        { book: 'jingui', evidenceLevel: 'disputed' },
      ]),
    ).toEqual({
      songben: { single: 0, corroborated: 1, disputed: 0, unchecked: 1 },
      jingui: { single: 0, corroborated: 0, disputed: 1, unchecked: 0 },
    })
  })
})

describe('loadIntegrationInputs', () => {
  let root: string | undefined
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('目录全缺时优雅降级并列出缺失文件', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'tcm-integration-'))
    const inputs = await loadIntegrationInputs(root)
    expect(inputs.evidenceFiles).toEqual([])
    expect(inputs.commentaries).toBeNull()
    expect(inputs.syndromes).toBeNull()
    expect(inputs.witnesses).toBeNull()
    expect(inputs.clauseAttributes).toBeNull()
    expect(inputs.missingFiles).toEqual([
      'data/integration/evidence/shanghan-kb.json',
      'data/integration/evidence/collation-<bookId>.json',
      'data/integration/commentaries.json',
      'data/integration/syndromes.json',
      'data/ontology/witnesses.json',
      'data/integration/clause-attributes.json',
    ])
    expect(inputs.invalidFiles).toEqual([])
  })

  it('读取部分文件，损坏或形状不符的记入 invalidFiles', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'tcm-integration-'))
    const evidenceDir = path.join(root, 'data', 'integration', 'evidence')
    await mkdir(evidenceDir, { recursive: true })
    await writeFile(path.join(evidenceDir, 'collation-songben.json'), JSON.stringify(evidenceFile([record('kanripo', 'agree')])))
    await writeFile(path.join(evidenceDir, 'shanghan-kb.json'), '{ broken')
    await writeFile(path.join(evidenceDir, 'other.json'), JSON.stringify({ hello: 1 }))
    await writeFile(path.join(root, 'data', 'integration', 'commentaries.json'), JSON.stringify({ not: 'array' }))
    await writeFile(path.join(root, 'data', 'integration', 'clause-attributes.json'), JSON.stringify({ 'songben-12': {} }))
    const inputs = await loadIntegrationInputs(root)
    expect(inputs.evidenceFiles.map((item) => item.file)).toEqual(['data/integration/evidence/collation-songben.json'])
    expect(inputs.invalidFiles.map((item) => item.file)).toEqual([
      'data/integration/evidence/other.json',
      'data/integration/evidence/shanghan-kb.json',
      'data/integration/commentaries.json',
    ])
    expect(inputs.missingFiles).toEqual(['data/integration/syndromes.json', 'data/ontology/witnesses.json'])
    expect(inputs.clauseAttributes).toEqual({ 'songben-12': {} })
  })
})

describe('backfillFormulaHerbs', () => {
  const KNOWN = new Set(['半夏', '人参', '白蜜', '厚朴', '大黄', '枳实', '甘草', '桂枝', '芍药', '生姜', '大枣'])
  const herb = (name: string): FormulaHerb => ({ herbId: name, name, rawText: name, doseRaw: '' })
  const formulaOf = (id: string, book: Formula['book'], name: string, herbNames: string[]): Formula => ({
    id,
    name,
    book,
    herbs: herbNames.map(herb),
    preparation: '',
    modifications: [],
    sourceClauseIds: [],
  })
  const BOOK_SCORE: Record<string, number> = { songben: 120, jingui: 115, zhongxi: 78, jingyue: 75, qianjin: 40 }
  const ZHONGJING = new Set(['songben', 'jingui', 'guilin', 'yizong'])
  const policy: HerbBackfillPolicy = {
    sanitize: (formula) => {
      const herbs = formula.herbs.filter((item) => !item.name.startsWith('不可'))
      return herbs.length === formula.herbs.length ? formula : { ...formula, herbs }
    },
    canonicalName: (name) => (name === '桂枝汤方' ? '桂枝汤' : name),
    donorScore: (formula) => (BOOK_SCORE[formula.book] ?? 10) * 1000 + formula.herbs.length,
    isDonorBookAllowed: (donor, recipient) =>
      ZHONGJING.has(recipient) ? ZHONGJING.has(donor) : BOOK_SCORE[donor] !== undefined,
    canDonate: () => true,
    isJunkHerbName: (name) => name.length > 6 || name.startsWith('不可'),
    isKnownHerbName: (name) => KNOWN.has(name),
  }

  it('可解析判定：注语不算组成；供药方未收录药名受长度与比例约束', () => {
    expect(hasResolvableComposition([herb('久则伤津伤气'), herb('加赭石以助之')], policy)).toBe(false)
    expect(hasResolvableComposition([herb('久则伤津伤气'), herb('半夏')], policy)).toBe(true)
    expect(isResolvableDonorHerbList([herb('久则伤津伤气'), herb('加赭石以助之')], policy)).toBe(false)
    expect(isResolvableDonorHerbList([herb('半夏'), herb('人参'), herb('白蜜'), herb('生甘草')], policy)).toBe(true)
    expect(isResolvableDonorHerbList([herb('半夏'), herb('生甘草')], policy)).toBe(true)
    expect(isResolvableDonorHerbList([herb('半夏'), herb('生甘草'), herb('白粳米')], policy)).toBe(false)
    expect(isResolvableDonorHerbList([herb('半夏'), herb('人参'), herb('白蜜'), herb('桂府滑石粉')], policy)).toBe(false)
    expect(isResolvableDonorHerbList([], policy)).toBe(false)
  })

  it('大半夏汤：注语供药方被拒；仲景定本不接受景岳/千金同名方；他书可得景岳组成', () => {
    const formulas = [
      formulaOf('jingui-formula-大半夏汤', 'jingui', '大半夏汤', []),
      formulaOf('zhongxi-formula-大半夏汤', 'zhongxi', '大半夏汤', ['久则伤津伤气', '加赭石以助之']),
      formulaOf('jingyue-formula-大半夏汤', 'jingyue', '大半夏汤', ['半夏', '人参', '白蜜']),
      formulaOf('qianjin-formula-大半夏汤', 'qianjin', '大半夏汤', ['半夏', '大枣', '甘草', '人参']),
      formulaOf('linzheng-formula-大半夏汤', 'linzheng', '大半夏汤', []),
      formulaOf('jingui-formula-厚朴三物汤', 'jingui', '厚朴三物汤', []),
    ]
    const result = backfillFormulaHerbs(formulas, policy)
    const byId = new Map(result.formulas.map((item) => [item.id, item]))
    expect(byId.get('jingui-formula-大半夏汤')!.herbs).toEqual([])
    expect(byId.get('jingui-formula-大半夏汤')!.herbsBackfilledFrom).toBeUndefined()
    expect(byId.get('jingui-formula-厚朴三物汤')!.herbs).toEqual([])
    expect(byId.get('linzheng-formula-大半夏汤')!.herbs.map((item) => item.name)).toEqual(['半夏', '人参', '白蜜'])
    expect(byId.get('linzheng-formula-大半夏汤')!.herbsBackfilledFrom).toBe('jingyue-formula-大半夏汤')
    expect(byId.get('zhongxi-formula-大半夏汤')!.herbsBackfilledFrom).toBe('jingyue-formula-大半夏汤')
    expect(result.unresolvedOwnReplaced).toEqual(['zhongxi-formula-大半夏汤'])
    expect(result.formulas.flatMap((item) => item.herbs.map((h) => h.name))).not.toContain('久则伤津伤气')
  })

  it('原书已有组成时不回填、不覆盖（即使有更高优先级同名方）', () => {
    const formulas = [
      formulaOf('songben-formula-桂枝汤', 'songben', '桂枝汤', ['桂枝', '芍药', '甘草', '生姜', '大枣']),
      formulaOf('qianjin-formula-桂枝汤', 'qianjin', '桂枝汤', ['桂枝', '甘草']),
    ]
    const result = backfillFormulaHerbs(formulas, policy)
    expect(result.formulas[1]!.herbs.map((item) => item.name)).toEqual(['桂枝', '甘草'])
    expect(result.backfilled).toEqual([])
  })

  it('songben↔jingui 互补；规范名同名可回填；被清洗过的方剂不作供药方；不链式回填', () => {
    const formulas = [
      formulaOf('jingui-formula-桂枝汤', 'jingui', '桂枝汤方', []),
      formulaOf('songben-formula-桂枝汤', 'songben', '桂枝汤', ['桂枝', '芍药', '甘草', '生姜', '大枣']),
      formulaOf('jingyue-formula-大黄甘草汤', 'jingyue', '大黄甘草汤', ['不可误认大黄', '甘草']),
      formulaOf('linzheng-formula-大黄甘草汤', 'linzheng', '大黄甘草汤', []),
      formulaOf('qianjin-formula-大黄甘草汤', 'qianjin', '大黄甘草汤', ['大黄', '甘草']),
      formulaOf('songben-formula-甘草汤', 'songben', '甘草汤', []),
    ]
    const result = backfillFormulaHerbs(formulas, policy)
    const byId = new Map(result.formulas.map((item) => [item.id, item]))
    expect(byId.get('jingui-formula-桂枝汤')!.herbsBackfilledFrom).toBe('songben-formula-桂枝汤')
    expect(byId.get('jingui-formula-桂枝汤')!.herbs).toHaveLength(5)
    expect(byId.get('jingui-formula-桂枝汤')!.herbs[0]).not.toBe(formulas[1]!.herbs[0])
    expect(byId.get('linzheng-formula-大黄甘草汤')!.herbsBackfilledFrom).toBe('qianjin-formula-大黄甘草汤')
    expect(byId.get('jingyue-formula-大黄甘草汤')!.herbs.map((item) => item.name)).toEqual(['甘草'])
    expect(byId.get('songben-formula-甘草汤')!.herbs).toEqual([])
    expect(result.eligibleDonorCount).toBe(2)
  })
})
