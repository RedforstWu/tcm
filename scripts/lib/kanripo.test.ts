import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ANNOTATION_MIN_INDENT,
  KANRIPO_LICENSE,
  isLikelyAnnotation,
  kanripoEvidence,
  loadKanripoText,
  measureIndent,
  parseKanripoHeader,
  parseKanripoJuan,
  parseKanripoLocator,
} from './kanripo.ts'
import { TextDecodingError } from './jobkoko.ts'

const FIXTURE_DIR = path.join(import.meta.dirname, '__fixtures__', 'kanripo', 'KR3e0007@SBCK')

const HEADER = [
  '# -*- mode: mandoku-view; -*-',
  '#+TITLE: 新編金匱要畧方論',
  '#+DATE: 2015-09-11 03:53:33.028697',
  '#+PROPERTY: ID KR3e0007',
  '#+PROPERTY: BASEEDITION SBCK    ',
  '#+PROPERTY: WITNESS SBCK',
  '#+PROPERTY: JUAN 1',
  '#+PROPERTY: FILE SB03n0126-001金匱要略-卷上.',
].join('\n')

const JUAN_SAMPLE = [
  HEADER,
  '<pb:KR3e0007_SBCK_001-1a>¶',
  '新編金匱要畧方論卷之上¶',
  '　　　　　尚書司封郎中充秘閣校理臣林億等詮次¶',
  '　　　臟腑經絡先後病脉證第一¶',
  '　問曰上工治未病何也○師曰夫治未病者見肝之病¶',
  '　　知肝傳脾當先實脾¶',
  '<pb:KR3e0007_SBCK_001-1b>¶',
  '　　苦入心甘入脾脾能傷腎¶',
  '　腹中痛苦冷者死(一云腹中冷/苦痛者死)鼻頭色㣲黒者有水¶',
  '　　心火&KR0148;盛則傷肺¶',
].join('\n')

describe('parseKanripoHeader', () => {
  it('解析标准 mandoku 文件头（含 BASEEDITION 尾随空格）', () => {
    expect(parseKanripoHeader(JUAN_SAMPLE)).toEqual({
      title: '新編金匱要畧方論',
      id: 'KR3e0007',
      baseEdition: 'SBCK',
      witness: 'SBCK',
      juan: 1,
      file: 'SB03n0126-001金匱要略-卷上.',
      date: '2015-09-11 03:53:33.028697',
      properties: {
        ID: 'KR3e0007',
        BASEEDITION: 'SBCK',
        WITNESS: 'SBCK',
        JUAN: '1',
        FILE: 'SB03n0126-001金匱要略-卷上.',
      },
    })
  })

  it('兼容 BOM、CRLF、缺 WITNESS 与额外属性（tls 分支）', () => {
    const text = '\uFEFF# -*- mode: mandoku-view -*-\r\n#+TITLE: 黃帝內經\r\n#+PROPERTY: ID KR3e0001\r\n#+PROPERTY: BASEEDITION tls\r\n#+PROPERTY: CAT 1pre-han,科學技術,醫學\r\n<pb:KR3e0001_tls_001-1a>¶\r\n'
    const header = parseKanripoHeader(text)
    expect(header.title).toBe('黃帝內經')
    expect(header.witness).toBeNull()
    expect(header.juan).toBeNull()
    expect(header.date).toBeNull()
    expect(header.properties.CAT).toBe('1pre-han,科學技術,醫學')
  })
})

describe('parseKanripoJuan', () => {
  const juan = parseKanripoJuan(JUAN_SAMPLE, { fileName: 'data/vendor/kanripo/KR3e0007@SBCK/KR3e0007_001.txt' })

  it('剥离 ¶、页码与缩进，标题行独立成段，双行小注去 /', () => {
    expect(juan.fileName).toBe('KR3e0007_001.txt')
    expect(juan.juanNumber).toBe(1)
    expect(juan.plainText).toBe(
      [
        '新編金匱要畧方論卷之上',
        '尚書司封郎中充秘閣校理臣林億等詮次',
        '臟腑經絡先後病脉證第一',
        '問曰上工治未病何也○師曰夫治未病者見肝之病知肝傳脾當先實脾苦入心甘入脾脾能傷腎腹中痛苦冷者死(一云腹中冷苦痛者死)鼻頭色㣲黒者有水心火&KR0148;盛則傷肺',
      ].join('\n'),
    )
    expect(juan.plainText).not.toContain('¶')
    expect(juan.plainText).not.toContain('<pb:')
    expect(juan.plainText).not.toContain('\u3000')
    expect(juan.headings.map((heading) => heading.text)).toEqual(['新編金匱要畧方論卷之上', '臟腑經絡先後病脉證第一'])
  })

  it('页面保留原始行与缩进宽度', () => {
    expect(juan.pages.map((page) => page.locator)).toEqual(['KR3e0007_SBCK_001-1a', 'KR3e0007_SBCK_001-1b'])
    const [firstPage, secondPage] = juan.pages
    expect(firstPage.page).toBe('1a')
    expect(firstPage.edition).toBe('SBCK')
    expect(firstPage.lines[1]).toBe('　　　　　尚書司封郎中充秘閣校理臣林億等詮次')
    expect(firstPage.indents).toEqual([0, 5, 3, 1, 2])
    expect(secondPage.lines[1]).toBe('　腹中痛苦冷者死(一云腹中冷/苦痛者死)鼻頭色㣲黒者有水')
  })

  it('offset → 页码锚点：页边界两侧', () => {
    const boundary = juan.plainText.indexOf('苦入心')
    expect(juan.offsetToLocator(0)).toBe('KR3e0007_SBCK_001-1a')
    expect(juan.offsetToLocator(boundary - 1)).toBe('KR3e0007_SBCK_001-1a')
    expect(juan.offsetToLocator(boundary)).toBe('KR3e0007_SBCK_001-1b')
    expect(juan.offsetToLocator(juan.plainText.length)).toBe('KR3e0007_SBCK_001-1b')
    expect(juan.pageStartOffsets).toEqual([0, boundary])
  })

  it('offset 越界或非整数时抛 RangeError', () => {
    expect(() => juan.offsetToLocator(-1)).toThrow(RangeError)
    expect(() => juan.offsetToLocator(juan.plainText.length + 1)).toThrow(RangeError)
    expect(() => juan.offsetToLocator(1.5)).toThrow(RangeError)
  })

  it('统计已知标记', () => {
    expect(juan.markupCounts).toMatchObject({
      pageBreak: 2,
      gaijiEntity: 1,
      inlineNote: 1,
      separator: 1,
      lineEnd: 10,
    })
    expect(juan.unknownMarkup).toEqual({})
    expect(juan.isFrontMatter).toBe(false)
  })

  it('页码标记出现在行中时切分到两页', () => {
    const parsed = parseKanripoJuan(`${HEADER}\n<pb:KR3e0007_SBCK_001-1a>¶\n甲乙<pb:KR3e0007_SBCK_001-1b>丙丁¶\n`, {
      fileName: 'KR3e0007_001.txt',
    })
    expect(parsed.pages.map((page) => page.lines)).toEqual([['甲乙'], ['丙丁']])
    expect(parsed.plainText).toBe('甲乙丙丁')
    expect(parsed.offsetToLocator(1)).toBe('KR3e0007_SBCK_001-1a')
    expect(parsed.offsetToLocator(2)).toBe('KR3e0007_SBCK_001-1b')
  })

  it('首个页码之前的正文以文件名主干为 locator；空页不占起点', () => {
    const parsed = parseKanripoJuan(`${HEADER}\n無頁碼¶\n<pb:KR3e0007_SBCK_001-1a>¶\n<pb:KR3e0007_SBCK_001-1b>¶\n有頁¶\n`, {
      fileName: 'KR3e0007_001.txt',
    })
    expect(parsed.pages.map((page) => page.locator)).toEqual([
      'KR3e0007_001',
      'KR3e0007_SBCK_001-1a',
      'KR3e0007_SBCK_001-1b',
    ])
    expect(parsed.offsetToLocator(0)).toBe('KR3e0007_001')
    expect(parsed.offsetToLocator(3)).toBe('KR3e0007_SBCK_001-1b')
  })

  it('同一页码连续出现（中间夹图片注释）时不重复建页', () => {
    const parsed = parseKanripoJuan(
      `${HEADER}\n<pb:KR3e0008_SBCK_003-51a>¶\n註解傷寒論卷第三¶\n<pb:KR3e0008_SBCK_003-51b>¶\n# SB1_0371-191.png\n<pb:KR3e0008_SBCK_003-51b>¶\n# ?\n`,
      { fileName: 'KR3e0008_003.txt' },
    )
    expect(parsed.pages.map((page) => page.locator)).toEqual(['KR3e0008_SBCK_003-51a', 'KR3e0008_SBCK_003-51b'])
    expect(parsed.markupCounts.pageBreak).toBe(3)
    expect(parsed.markupCounts.comment).toBe(2)
    expect(parsed.headings.map((heading) => heading.text)).toEqual(['註解傷寒論卷第三'])
  })

  it('无正文时定位抛错', () => {
    const parsed = parseKanripoJuan(HEADER, { fileName: 'KR3e0007_001.txt' })
    expect(parsed.plainText).toBe('')
    expect(() => parsed.offsetToLocator(0)).toThrow(RangeError)
  })

  it('组字式与缺字实体原样保留，组字式内括号不计为小注', () => {
    const parsed = parseKanripoJuan(`${HEADER}\n<pb:KR3e0007_SBCK_001-18b>¶\n　緩則身痒而[病-丙+(穩-禾)]疹蜀&KR0238;散¶\n`, {
      fileName: 'KR3e0007_001.txt',
    })
    expect(parsed.plainText).toBe('緩則身痒而[病-丙+(穩-禾)]疹蜀&KR0238;散')
    expect(parsed.markupCounts.idsComposition).toBe(1)
    expect(parsed.markupCounts.inlineNote).toBe(0)
    expect(parsed.markupCounts.gaijiEntity).toBe(1)
    expect(parsed.unknownMarkup).toEqual({})
  })

  it('未知标记保留原样并计数', () => {
    const parsed = parseKanripoJuan(
      `${HEADER}\n<pb:KR3e0007_SBCK_001-1a>¶\n甲<md:x>乙&amp;丙{丁}¶\n#+BEGIN_VERSE\n(未閉合¶\n`,
      { fileName: 'KR3e0007_001.txt' },
    )
    expect(parsed.plainText).toBe('甲<md:x>乙&amp;丙{丁}\n(未閉合')
    expect(parsed.unknownMarkup).toEqual({
      '<md>': 1,
      '&amp;': 1,
      'char:{': 1,
      'char:}': 1,
      '#+BEGIN_VERSE': 1,
      unbalancedParen: 1,
    })
  })

  it('tls 分支：org 标题、# 注释、无 ¶ 行与空行', () => {
    const text = [
      '# -*- mode: mandoku-view -*-',
      '#+TITLE: 黃帝內經',
      '#+PROPERTY: ID KR3e0001',
      '#+PROPERTY: BASEEDITION tls',
      '#+PROPERTY: JUAN 0',
      '<pb:KR3e0001_tls_001-1a>¶',
      '** 1 上古天真論篇第一',
      '',
      '1.1昔在黃帝，¶',
      '生而神靈，¶',
      '',
      '# src: SUWEN 1.1.2; ed. Renminweisheng 1982, p. 1',
      '# dating: 6230',
      '迺問於天師曰：¶',
      '余聞',
      '上古之人，¶',
    ].join('\n')
    const parsed = parseKanripoJuan(text, { fileName: 'KR3e0001_001.txt' })
    expect(parsed.juanNumber).toBe(1)
    expect(parsed.header.juan).toBe(0)
    expect(parsed.plainText).toBe('1 上古天真論篇第一\n1.1昔在黃帝，生而神靈，\n迺問於天師曰：余聞上古之人，')
    expect(parsed.markupCounts.orgHeading).toBe(1)
    expect(parsed.markupCounts.comment).toBe(2)
    expect(parsed.headings).toEqual([{ text: '1 上古天真論篇第一', offset: 0, locator: 'KR3e0001_tls_001-1a' }])
    expect(parsed.unknownMarkup).toEqual({})
  })

  it('_000 序/目録卷：卷内 FILE 分节断段并标记 frontMatter', () => {
    const text = [
      HEADER.replace('JUAN 1', 'JUAN 0').replace('001金匱要略-卷上', '000金匱要略-序'),
      '<pb:KR3e0007_SBCK_000-1a>¶',
      '新編金匱要畧方論序¶',
      '張仲景為傷寒雜病論¶',
      '#+PROPERTY: JUAN 0',
      '#+PROPERTY: FILE SB03n0126-000金匱要略-目録.',
      '<pb:KR3e0007_SBCK_000-3a>¶',
      '卷之上¶',
      '附方¶',
    ].join('\n')
    const parsed = parseKanripoJuan(text, { fileName: 'KR3e0007_000.txt' })
    expect(parsed.isFrontMatter).toBe(true)
    expect(parsed.fileSections).toEqual(['SB03n0126-000金匱要略-序.', 'SB03n0126-000金匱要略-目録.'])
    expect(parsed.markupCounts.sectionProperty).toBe(2)
    expect(parsed.plainText).toBe('新編金匱要畧方論序\n張仲景為傷寒雜病論\n卷之上\n附方')
  })

  it('疑似 GBK 乱码时抛出带文件名的错误', () => {
    const garbled = `${HEADER}\n<pb:KR3e0007_SBCK_001-1a>¶\n${'\uFFFD'.repeat(50)}¶\n`
    expect(() => parseKanripoJuan(garbled, { fileName: 'KR3e0007_001.txt' })).toThrow(TextDecodingError)
    expect(() => parseKanripoJuan(garbled, { fileName: 'KR3e0007_001.txt' })).toThrow(/KR3e0007_001\.txt/)
  })
})

describe('parseKanripoLocator', () => {
  it('拆分 ID / 版本 / 卷 / 叶面', () => {
    expect(parseKanripoLocator('KR3e0007_SBCK_001-1a')).toEqual({ id: 'KR3e0007', edition: 'SBCK', juan: 1, page: '1a' })
    expect(parseKanripoLocator('KR3e0007_001')).toBeNull()
  })
})

describe('缩进与注文启发式', () => {
  it('measureIndent 只计全角空格', () => {
    expect(measureIndent('　　知肝傳脾')).toBe(2)
    expect(measureIndent('知肝傳脾')).toBe(0)
  })

  it('isLikelyAnnotation：低格且非篇题', () => {
    const lowLine = `${'　'.repeat(ANNOTATION_MIN_INDENT)}大黄　乾姜　龍骨(各四/两)¶`
    expect(isLikelyAnnotation(lowLine)).toBe(true)
    expect(isLikelyAnnotation('　問曰上工治未病何也')).toBe(false)
    expect(isLikelyAnnotation('　　　臟腑經絡先後病脉證第一')).toBe(false)
    expect(isLikelyAnnotation({ text: '牡蠣湯治牡瘧', indent: ANNOTATION_MIN_INDENT + 1 })).toBe(true)
    expect(isLikelyAnnotation('　　　　¶')).toBe(false)
  })
})

describe('loadKanripoText', () => {
  const temporaryDirs: string[] = []
  afterAll(async () => {
    await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('按卷号读取，_000 序/目録单独标记，跨卷定位', async () => {
    const text = await loadKanripoText(FIXTURE_DIR)
    expect(text.id).toBe('KR3e0007')
    expect(text.branch).toBe('SBCK')
    expect(text.edition).toBe('SBCK')
    expect(text.title).toBe('新編金匱要畧方論')
    expect(text.juans.map((juan) => juan.juanNumber)).toEqual([1, 2])
    expect(text.frontMatter.map((juan) => juan.fileName)).toEqual(['KR3e0007_000.txt'])
    expect(text.fullText.startsWith('新編金匱要畧方論卷之上')).toBe(true)
    expect(text.fullText).not.toContain('今世但傳')

    expect(text.locate(text.fullText.indexOf('知肝傳脾'))).toEqual({
      juan: 1,
      fileName: 'KR3e0007_001.txt',
      locator: 'KR3e0007_SBCK_001-1a',
    })
    expect(text.locate(text.fullText.indexOf('苦入心')).locator).toBe('KR3e0007_SBCK_001-1b')
    expect(text.locate(text.fullText.indexOf('肺中風者'))).toEqual({
      juan: 2,
      fileName: 'KR3e0007_002.txt',
      locator: 'KR3e0007_SBCK_002-1a',
    })
    const separatorOffset = text.juanStartOffsets[1] - 1
    expect(text.fullText[separatorOffset]).toBe('\n')
    expect(text.locate(separatorOffset).locator).toBe('KR3e0007_SBCK_001-1b')
    expect(text.locate(text.fullText.length).juan).toBe(2)
    expect(() => text.locate(text.fullText.length + 1)).toThrow(RangeError)
    expect(text.markupCounts.gaijiEntity).toBe(1)
    expect(text.unknownMarkup).toEqual({})
  })

  it('includeFrontMatter 时序/目録计入正文', async () => {
    const text = await loadKanripoText(FIXTURE_DIR, { includeFrontMatter: true })
    expect(text.juans.map((juan) => juan.juanNumber)).toEqual([0, 1, 2])
    expect(text.frontMatter).toEqual([])
    expect(text.locate(0)).toEqual({ juan: 0, fileName: 'KR3e0007_000.txt', locator: 'KR3e0007_SBCK_000-1a' })
  })

  it('目录内无卷文件时抛错', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kanripo-empty-'))
    temporaryDirs.push(dir)
    await writeFile(path.join(dir, 'Readme.org'), '#+TITLE: x\n', 'utf8')
    await expect(loadKanripoText(dir)).rejects.toThrow(/无法确定 Kanripo 文本 ID/)
  })
})

describe('kanripoEvidence', () => {
  it('构造 sourceId / group / license', () => {
    expect(
      kanripoEvidence('KR3e0007', 'SBCK', '0123456789abcdef0123456789abcdef01234567', 'KR3e0007_SBCK_001-1a', '問曰上工治未病'),
    ).toEqual({
      sourceId: 'kanripo:KR3e0007@SBCK#0123456',
      group: 'kanripo',
      locator: 'KR3e0007_SBCK_001-1a',
      quote: '問曰上工治未病',
      license: KANRIPO_LICENSE,
    })
    expect(kanripoEvidence('KR3e0007', 'master', 'ABCDEF1', 'KR3e0007_SBCK_001-1a')).not.toHaveProperty('quote')
  })

  it('参数非法时抛错', () => {
    expect(() => kanripoEvidence('KR3e0007', 'SBCK', 'xyz', 'KR3e0007_SBCK_001-1a')).toThrow(/commit/)
    expect(() => kanripoEvidence('bad id', 'SBCK', 'abcdef1', 'KR3e0007_SBCK_001-1a')).toThrow(/ID/)
    expect(() => kanripoEvidence('KR3e0007', 'SB#CK', 'abcdef1', 'KR3e0007_SBCK_001-1a')).toThrow(/分支/)
    expect(() => kanripoEvidence('KR3e0007', 'SBCK', 'abcdef1', 'KR3e0008_SBCK_001-1a')).toThrow(/locator/)
  })
})
