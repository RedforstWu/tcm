import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Concept } from '@/types/ontology'
import {
  bookIdFromClauseId,
  buildCommentaryIndex,
  channelConceptIdFromSixChannel,
  clauseHref,
  evidenceHref,
  evidenceLevelMeta,
  formatEvidenceRatio,
  hasKanripoEvidence,
  isKangpingLayer,
  kanripoFileUrl,
  loadCommentaryIndex,
  normalizeEvidenceList,
  parseKanripoLocator,
  readSyndromeProfile,
  readVariantSegments,
  resetIntegrationCache,
  sourceGroupLabel,
} from './integration'

const kanripoEvidence = {
  sourceId: 'kanripo:KR3e0007@SBCK',
  group: 'kanripo',
  locator: 'KR3e0007_SBCK_001-1a',
  license: 'CC BY-SA 4.0',
}

function commentary(overrides: Record<string, unknown>) {
  return {
    id: 'commentary-尤怡-012',
    clauseId: 'songben-12',
    commentator: '尤怡',
    sourceBook: '伤寒贯珠集',
    formulaIds: [],
    quotes: [{ text: '太阳中风者，阳浮而阴弱。', verified: true, evidence: kanripoEvidence }],
    evidence: [kanripoEvidence],
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: { ok?: boolean; contentType?: string } = {}) {
  return {
    ok: init.ok ?? true,
    headers: new Headers({ 'content-type': init.contentType ?? 'application/json' }),
    json: async () => body,
  } as unknown as Response
}

describe('parseKanripoLocator', () => {
  it('解析仓库、分支、卷号与页码', () => {
    expect(parseKanripoLocator('KR3e0007_SBCK_001-1a')).toEqual({
      repoId: 'KR3e0007',
      branch: 'SBCK',
      juan: '001',
      page: '1a',
    })
    expect(parseKanripoLocator('KR3e0008_SBCK_010')).toEqual({
      repoId: 'KR3e0008',
      branch: 'SBCK',
      juan: '010',
    })
  })

  it('非 Kanripo 格式返回 null', () => {
    expect(parseKanripoLocator('01_条文/太阳病/条文-012.md')).toBeNull()
    expect(parseKanripoLocator('KR3e0007')).toBeNull()
    expect(parseKanripoLocator('KR3e0007_SBCK_1-1a')).toBeNull()
    expect(parseKanripoLocator('')).toBeNull()
    expect(parseKanripoLocator(undefined)).toBeNull()
  })
})

describe('kanripoFileUrl / evidenceHref', () => {
  it('生成 GitHub 卷文件链接', () => {
    expect(kanripoFileUrl('KR3e0007_SBCK_001-1a')).toBe(
      'https://github.com/kanripo/KR3e0007/blob/SBCK/KR3e0007_001.txt',
    )
  })

  it('仅 kanripo 来源组生成外链', () => {
    expect(evidenceHref({ group: 'kanripo', locator: 'KR3e0008_SBCK_003-12b' })).toBe(
      'https://github.com/kanripo/KR3e0008/blob/SBCK/KR3e0008_003.txt',
    )
    expect(evidenceHref({ group: 'wikisource', locator: 'KR3e0008_SBCK_003-12b' })).toBeNull()
    expect(evidenceHref({ group: 'kanripo', locator: 'bad-locator' })).toBeNull()
  })

  it('识别是否含 Kanripo 证据', () => {
    expect(hasKanripoEvidence([{ group: 'wikisource' }, { group: 'kanripo' }])).toBe(true)
    expect(hasKanripoEvidence([{ group: 'derived' }])).toBe(false)
    expect(hasKanripoEvidence([])).toBe(false)
  })
})

describe('等级与来源组标签', () => {
  it('映射三种证据等级', () => {
    expect(evidenceLevelMeta('single')?.label).toBe('单一来源')
    expect(evidenceLevelMeta('corroborated')?.label).toBe('已互证')
    expect(evidenceLevelMeta('disputed')?.label).toBe('有分歧')
    expect(evidenceLevelMeta('corroborated')?.badgeClass).toContain('emerald')
    expect(evidenceLevelMeta('disputed')?.badgeClass).toContain('amber')
  })

  it('缺失或未知等级返回 null', () => {
    expect(evidenceLevelMeta(undefined)).toBeNull()
    expect(evidenceLevelMeta('')).toBeNull()
    expect(evidenceLevelMeta('toString')).toBeNull()
    expect(evidenceLevelMeta('unknown')).toBeNull()
  })

  it('来源组中文名，未知组原样返回', () => {
    expect(sourceGroupLabel('wikisource')).toBe('维基文库')
    expect(sourceGroupLabel('kanripo')).toBe('漢籍リポジトリ Kanripo')
    expect(sourceGroupLabel('web-simplified')).toBe('网络流传简体本')
    expect(sourceGroupLabel('derived')).toBe('二次整理库')
    expect(sourceGroupLabel('other')).toBe('other')
  })

  it('康平层次校验', () => {
    expect(isKangpingLayer('追文')).toBe(true)
    expect(isKangpingLayer('旁注')).toBe(false)
    expect(isKangpingLayer(undefined)).toBe(false)
  })
})

describe('normalizeEvidenceList / readVariantSegments', () => {
  it('丢弃结构不完整的证据项，许可缺失时标注未声明', () => {
    const list = normalizeEvidenceList([
      kanripoEvidence,
      { sourceId: 'x', group: 'derived' },
      null,
      { sourceId: 'jobkoko@abc', group: 'web-simplified', locator: 'S-003.txt' },
    ])
    expect(list).toHaveLength(2)
    expect(list[1]?.license).toBe('未声明')
    expect(normalizeEvidenceList(undefined)).toEqual([])
  })

  it('保留比对字段、结论与相似度；非法值丢弃', () => {
    const [valid, invalid] = normalizeEvidenceList([
      { ...kanripoEvidence, field: 'doses', verdict: 'variant', ratio: 0.8667 },
      { ...kanripoEvidence, field: 'bogus', verdict: 'maybe', ratio: 1.5 },
    ])
    expect(valid).toMatchObject({ field: 'doses', verdict: 'variant', ratio: 0.8667 })
    expect(invalid).not.toHaveProperty('field')
    expect(invalid).not.toHaveProperty('verdict')
    expect(invalid).not.toHaveProperty('ratio')
    expect(formatEvidenceRatio(0.8667)).toBe('87%')
    expect(formatEvidenceRatio(Number.NaN)).toBeNull()
    expect(formatEvidenceRatio(undefined)).toBeNull()
  })

  it('读取异文片段；全为 equal 或缺失时为空', () => {
    expect(
      readVariantSegments({
        ...kanripoEvidence,
        variants: [
          { op: 'equal', local: '太阳', witness: '太阳' },
          { op: 'replace', local: '病', witness: '病者' },
          { op: 'bogus', local: 'x', witness: 'y' },
        ],
      }),
    ).toEqual([
      { op: 'equal', local: '太阳', witness: '太阳' },
      { op: 'replace', local: '病', witness: '病者' },
    ])
    expect(readVariantSegments({ variants: [{ op: 'equal', local: 'a', witness: 'a' }] })).toEqual([])
    expect(readVariantSegments(kanripoEvidence)).toEqual([])
  })
})

describe('buildCommentaryIndex', () => {
  it('按 clauseId 建索引，并按 成无己→柯琴→尤怡 排序', () => {
    const index = buildCommentaryIndex([
      commentary({}),
      commentary({ id: 'commentary-成无己-012', commentator: '成无己', sourceBook: '注解伤寒论' }),
      commentary({ id: 'commentary-柯琴-012', commentator: '柯琴' }),
      commentary({ id: 'commentary-尤怡-013', clauseId: 'songben-13' }),
    ])
    expect(index.get('songben-12')?.map((item) => item.commentator)).toEqual(['成无己', '柯琴', '尤怡'])
    expect(index.get('songben-13')).toHaveLength(1)
    expect(index.get('songben-14')).toBeUndefined()
  })

  it('只保留核验通过的原句，无可展示原句的注文丢弃', () => {
    const index = buildCommentaryIndex([
      commentary({
        quotes: [
          { text: '已核验', verified: true },
          { text: '未核验', verified: false },
          { text: '', verified: true },
        ],
      }),
      commentary({ id: 'commentary-柯琴-013', clauseId: 'songben-13', quotes: [{ text: '未核验', verified: false }] }),
    ])
    expect(index.get('songben-12')?.[0]?.quotes.map((quote) => quote.text)).toEqual(['已核验'])
    expect(index.has('songben-13')).toBe(false)
  })

  it('忽略重复 id 与非法项，非数组输入得到空索引', () => {
    const index = buildCommentaryIndex([commentary({}), commentary({}), null, 'x', { id: 'a' }])
    expect(index.get('songben-12')).toHaveLength(1)
    expect(buildCommentaryIndex(undefined).size).toBe(0)
    expect(buildCommentaryIndex({ clauseId: 'songben-1' }).size).toBe(0)
  })
})

describe('loadCommentaryIndex 缺失数据降级', () => {
  afterEach(() => {
    resetIntegrationCache()
    vi.restoreAllMocks()
  })

  it('404 时返回空索引', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(null, { ok: false }))
    const index = await loadCommentaryIndex(fetchImpl as unknown as typeof fetch)
    expect(index.size).toBe(0)
  })

  it('开发服务器回退 HTML 时返回空索引', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('<!doctype html>', { contentType: 'text/html' }))
    const index = await loadCommentaryIndex(fetchImpl as unknown as typeof fetch)
    expect(index.size).toBe(0)
  })

  it('网络错误时返回空索引且不抛错', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline')
    })
    await expect(loadCommentaryIndex(fetchImpl as unknown as typeof fetch)).resolves.toEqual(new Map())
  })

  it('成功加载后缓存，失败不缓存', async () => {
    const failing = vi.fn(async () => jsonResponse(null, { ok: false }))
    await loadCommentaryIndex(failing as unknown as typeof fetch)
    const succeeding = vi.fn(async () => jsonResponse([commentary({})]))
    const first = await loadCommentaryIndex(succeeding as unknown as typeof fetch)
    const second = await loadCommentaryIndex(succeeding as unknown as typeof fetch)
    expect(first.get('songben-12')).toHaveLength(1)
    expect(second).toBe(first)
    expect(succeeding).toHaveBeenCalledTimes(1)
  })
})

describe('条文链接与证型字段', () => {
  it('由条文 id 推出书目', () => {
    expect(bookIdFromClauseId('songben-12')).toBe('songben')
    expect(bookIdFromClauseId('jingui-1-1')).toBe('jingui')
    expect(bookIdFromClauseId('nosuchbook-1')).toBeNull()
    expect(bookIdFromClauseId('songben')).toBeNull()
    expect(clauseHref('songben-12')).toBe(`/read/songben?clause=${encodeURIComponent('songben-12')}`)
    expect(clauseHref('x-1')).toBeNull()
  })

  it('宽松读取证型附加字段，缺失时为空', () => {
    const base: Concept = {
      id: 'syndrome.太阳中风证',
      type: 'syndrome',
      prefLabel: '太阳中风证',
      altLabels: [],
      reviewStatus: 'ai-draft',
    }
    expect(readSyndromeProfile(base)).toEqual({
      mainSymptoms: [],
      mainFormulaIds: [],
      clauseIds: [],
      differentials: [],
    })
    const rich = {
      ...base,
      broader: ['channel.太阳'],
      mainSymptoms: ['发热', '汗出', 1],
      mainFormulaIds: ['songben-formula-桂枝汤'],
      clauseIds: ['songben-12'],
      differentials: [
        { targetConceptId: 'syndrome.太阳伤寒证', note: '有汗无汗' },
        { targetConceptId: 'syndrome.太阳中风证' },
        { note: '缺目标' },
      ],
    } as Concept
    const profile = readSyndromeProfile(rich)
    expect(profile.sixChannel).toBe('太阳')
    expect(profile.mainSymptoms).toEqual(['发热', '汗出'])
    expect(profile.differentials).toEqual([{ targetConceptId: 'syndrome.太阳伤寒证', note: '有汗无汗' }])
    expect(readSyndromeProfile({ ...rich, sixChannel: '太阳病' } as Concept).sixChannel).toBe('太阳病')
  })

  it('六经病名映射经络概念 id', () => {
    expect(channelConceptIdFromSixChannel('太阳病')).toBe('channel.太阳')
    expect(channelConceptIdFromSixChannel('少阴')).toBe('channel.少阴')
  })
})
