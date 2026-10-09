import { describe, expect, it, vi } from 'vitest'
import type { Clause } from '../../src/types/data.ts'

// 解析入口会写 data/parsed；测试只读 data/raw，在内存里断言
vi.mock('../lib/fs-utils.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/fs-utils.ts')>()
  return {
    ...actual,
    ensureDir: vi.fn(async () => {}),
    writeJson: vi.fn(async () => {}),
    writeText: vi.fn(async () => {}),
  }
})

import { runBianzhengParse } from './bianzheng.ts'
import { runFunankeParse } from './funanke.ts'
import { runFunvkeParse } from './funvke.ts'
import { runJingyueParse } from './jingyue.ts'
import { runPiweiParse } from './piwei.ts'
import { runQianjinParse } from './qianjin.ts'
import { runRumenParse } from './rumen.ts'
import { runShennongParse } from './shennong.ts'
import { runWaitaiParse } from './waitai.ts'
import { runWenreParse } from './wenre.ts'
import { runXumingyiParse } from './xumingyi.ts'

/** 整本解析较慢（景岳、续名医类案各数千条） */
const FULL_BOOK_TIMEOUT_MS = 60_000
const WIKI_HEADING_MARK_RE = /={2,}/
const WIKI_TEMPLATE_MARK_RE = /\{\{|\}\}/
const SKQS_VOLUME_TITLE_RE =
  /[钦饮]定四库[全金]书|(?:儒门事亲|景岳全书|续?名医类案|外台秘要方?)[卷巻][一二三四五六七八九十百]+|<子部/

function clauseById(clauses: Clause[], id: string): Clause {
  const clause = clauses.find((item) => item.id === id)
  expect(clause, `缺少条文 ${id}`).toBeDefined()
  return clause!
}

function expectUniqueIds(clauses: Clause[]): void {
  expect(new Set(clauses.map((clause) => clause.id)).size).toBe(clauses.length)
}

describe('维基标题不并入条文', () => {
  it(
    'funvke：139 条四级条文 id 不变，无四级小节的三级小节接在其后',
    async () => {
      const { clauses } = await runFunvkeParse()
      expectUniqueIds(clauses)
      expect(clauses.filter((clause) => WIKI_HEADING_MARK_RE.test(clause.text))).toEqual([])
      expect(clauses).toHaveLength(145)
      expect(clauseById(clauses, 'funvke-0003').text).not.toContain('黑带下')
      const heidai = clauseById(clauses, 'funvke-0004')
      expect(heidai.heading).toBe('黑带下（四）')
      expect(heidai.text.startsWith('妇人有带下而色黑者')).toBe(true)
      expect(clauseById(clauses, 'funvke-0140').heading).toBe('产后总论')
    },
    FULL_BOOK_TIMEOUT_MS,
  )

  it(
    'funanke：条文数不变且不含标题',
    async () => {
      const { clauses } = await runFunankeParse()
      expectUniqueIds(clauses)
      expect(clauses).toHaveLength(222)
      expect(clauses.filter((clause) => WIKI_HEADING_MARK_RE.test(clause.text))).toEqual([])
    },
    FULL_BOOK_TIMEOUT_MS,
  )

  it(
    'bianzheng：下一门标题不并入末则，跋单列为末条',
    async () => {
      const { clauses } = await runBianzhengParse()
      expectUniqueIds(clauses)
      expect(clauses.filter((clause) => WIKI_HEADING_MARK_RE.test(clause.text))).toEqual([])
      expect(clauses).toHaveLength(506)
      expect(clauseById(clauses, 'bianzheng-0505').text.endsWith('以受天谴也。')).toBe(true)
      const postscript = clauseById(clauses, 'bianzheng-0506')
      expect(postscript.heading).toBe('跋')
      expect(postscript.text.startsWith('远公陈先生真奇士也。')).toBe(true)
    },
    FULL_BOOK_TIMEOUT_MS,
  )

  it(
    'qianjin：方块不含下一小节；截下的小节与新解析出的方都排在既有条文之后',
    async () => {
      const { clauses, formulas } = await runQianjinParse()
      expectUniqueIds(clauses)
      expect(clauses.filter((clause) => WIKI_HEADING_MARK_RE.test(clause.text))).toEqual([])
      expect(clauses.filter((clause) => WIKI_TEMPLATE_MARK_RE.test(clause.text))).toEqual([])

      const formulaClauses = clauses.filter((clause) => clause.formulaIds.length > 0)
      const detachedClauses = clauses.filter((clause) => clause.formulaIds.length === 0)
      const lastFormulaOrder = Math.max(...formulaClauses.map((clause) => clause.order))
      expect(Math.min(...detachedClauses.map((clause) => clause.order))).toBeGreaterThan(lastFormulaOrder)
      expect(formulaClauses.find((clause) => clause.heading === '白马茎丸')?.order).toBe(lastFormulaOrder)
      expect(
        detachedClauses.some(
          (clause) => clause.heading === '灸法' && clause.text.startsWith('妇人绝子，灸然谷五十壮。'),
        ),
      ).toBe(true)

      expect(formulas.find((formula) => formula.name === '神化丸')?.herbs).toHaveLength(31)
    },
    FULL_BOOK_TIMEOUT_MS,
  )
})

describe('维基模板不残留', () => {
  it(
    'piwei：{{*|…}} 小注展开为正文',
    async () => {
      const { clauses } = await runPiweiParse()
      expect(clauses.filter((clause) => WIKI_TEMPLATE_MARK_RE.test(clause.text))).toEqual([])
      expect(clauses.some((clause) => clause.text.includes('奇而至耦者也。（阳分奇，阴分偶。）泻阴火'))).toBe(true)
    },
    FULL_BOOK_TIMEOUT_MS,
  )

  it(
    'wenre：NoteTA 不残留',
    async () => {
      const { clauses } = await runWenreParse()
      expect(clauses.filter((clause) => WIKI_TEMPLATE_MARK_RE.test(clause.text))).toEqual([])
    },
    FULL_BOOK_TIMEOUT_MS,
  )

  it(
    'waitai：模板不残留，卷末方不跨卷',
    async () => {
      const { clauses, formulas } = await runWaitaiParse()
      expect(clauses.filter((clause) => WIKI_TEMPLATE_MARK_RE.test(clause.text))).toEqual([])
      expect(clauses.filter((clause) => SKQS_VOLUME_TITLE_RE.test(clause.text))).toEqual([])
      expect(formulas.find((formula) => formula.name === '乌梅饮')?.herbs).toHaveLength(4)
    },
    FULL_BOOK_TIMEOUT_MS,
  )
})

describe('四库本卷题不混入正文，分段与 id 不变', () => {
  it(
    'rumen：卷十首条只剩正文',
    async () => {
      const { clauses } = await runRumenParse()
      expect(clauses.filter((clause) => SKQS_VOLUME_TITLE_RE.test(clause.text))).toEqual([])
      expect(clauseById(clauses, 'rumen-010-0001').text).toBe(
        '外有风寒暑湿属天之四令无形也内有饥饱劳逸属天之四令有形也',
      )
      expect(clauseById(clauses, 'rumen-010-0002').text.startsWith('一者始因气动')).toBe(true)
    },
    FULL_BOOK_TIMEOUT_MS,
  )

  it(
    'jingyue：卷尾题与分类签删去，卷末短正文保留',
    async () => {
      const { clauses } = await runJingyueParse()
      expect(clauses.filter((clause) => SKQS_VOLUME_TITLE_RE.test(clause.text))).toEqual([])
      expect(clauseById(clauses, 'jingyue-019-0076').text).toBe('【加味四七汤】局方七气汤')
    },
    FULL_BOOK_TIMEOUT_MS,
  )

  it(
    'xumingyi：卷尾题删去，卷末短正文保留',
    async () => {
      const { clauses } = await runXumingyiParse()
      expect(clauses.filter((clause) => SKQS_VOLUME_TITLE_RE.test(clause.text))).toEqual([])
      expect(clauseById(clauses, 'xumingyi-058-0052').text).toBe(
        '【破伤风】按卫生寳鉴以此方兼治狂犬所伤并诸犬咬神効',
      )
    },
    FULL_BOOK_TIMEOUT_MS,
  )
})

describe('全角空格', () => {
  it(
    'shennong：药名与正文连写不变',
    async () => {
      const { monographs } = await runShennongParse()
      const yuquan = monographs.find((monograph) => monograph.id === 'shennong-玉泉')
      expect(yuquan?.rawText.startsWith('玉泉味甘平。')).toBe(true)
      expect(monographs.filter((monograph) => monograph.rawText.includes(' '))).toEqual([])
    },
    FULL_BOOK_TIMEOUT_MS,
  )
})
