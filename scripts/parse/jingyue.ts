import path from 'node:path'
import type { BookId, Clause, Formula } from '../../src/types/data.ts'
import {
  buildClausesFromSections,
  splitParagraphs,
  type WikiSection,
} from '../lib/generic-wiki-parse.ts'
import { ensureDir, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { extractJingyueFangzhenBlocks } from '../lib/jingyue-formula.ts'
import { splitSkqsVolumes } from '../lib/skqs-wiki.ts'

const BOOK_ID = 'jingyue' as BookId
const RAW_FILENAME = 'jingyue-quanshu.wiki'
/** 每卷最多条文数；分卷后可提高，避免单卷爆内存 */
const MAX_CLAUSES_PER_CHAPTER = 800

function limitSectionParagraphs(
  sections: WikiSection[],
  maxPerChapter: number,
): { sections: WikiSection[]; truncated: boolean } {
  let truncated = false
  const limited: WikiSection[] = []
  for (const section of sections) {
    const paragraphs = splitParagraphs(section.body)
    if (paragraphs.length === 0) {
      limited.push(section)
      continue
    }
    if (paragraphs.length > maxPerChapter) {
      truncated = true
      limited.push({
        ...section,
        body: paragraphs.slice(0, maxPerChapter).join('\n\n'),
      })
    } else {
      limited.push({
        ...section,
        body: paragraphs.join('\n\n'),
      })
    }
  }
  return { sections: limited, truncated }
}

/**
 * 《景岳全书》：临床卷条文粗抽 + 卷51–64 八阵方块组方（SK notes 展平）。
 */
export async function runJingyueParse(): Promise<{
  clauses: Clause[]
  formulas: Formula[]
  stats: {
    chapterCount: number
    clauseCount: number
    formulaCount: number
    withHerbs: number
    truncated: boolean
  }
}> {
  const root = projectRoot()
  const raw = await readText(path.join(root, 'data', 'raw', RAW_FILENAME))
  const sections = splitSkqsVolumes(raw)
  const { sections: limited, truncated } = limitSectionParagraphs(
    sections,
    MAX_CLAUSES_PER_CHAPTER,
  )
  const { clauses, formulas: baseFormulas } = buildClausesFromSections({
    bookId: BOOK_ID,
    sections: limited,
    splitIntoParagraphs: true,
  })

  const fangzhen = extractJingyueFangzhenBlocks(raw)

  const normalizeName = (name: string) => {
    let text = name
      .replace(/隂/g, '阴')
      .replace(/陽/g, '阳')
      .replace(/關|闗/g, '关')
      .replace(/囘/g, '回')
      .replace(/荳/g, '豆')
      .replace(/䓻/g, '蔻')
    if (text === '肉豆蔻丸') text = '肉豆丸'
    if (text === '柴芩煎') text = '柴苓煎'
    if (text === '子仁汤') text = '薏苡仁汤'
    return text
  }

  // 临床卷误抽的「…宜某汤或某煎」长串不是独立方名
  const kept = baseFormulas.filter((formula) => {
    if (formula.herbs.length > 0) return true
    const name = formula.name
    if (name.length > 10) return false
    if (name.length < 3) return false
    if (/宜|或|者|也|若|凡|必|证也|主之|如|须|兼|之药|送下|为度|即瘥|极效|无妨|内服/.test(name)) {
      return false
    }
    // 「火热之邪必宜凉如竹叶石膏汤」——「凉如」为状语，非方名
    if (/^凉如|^宜凉|^必宜凉/.test(name)) return false
    if (
      /^[以如须兼此]|东垣加减|壮水|寒凉|温补|养血|托里|火烘|金银花散|金钥匙|二圣散|芦荟二丸|大小和中|六君子送|蜜酥煎/.test(
        name,
      )
    ) {
      return false
    }
    if (!/(?:汤|散|丸|膏|煎|饮|丹)$/.test(name)) return false
    // 「五福饮三阴煎」类连写；「地黄芦荟二丸」「金钥匙二圣散」
    if ((name.match(/汤|散|丸|膏|煎|饮|丹/g) ?? []).length >= 2) return false
    // 「牛乳半斤…煎」「一二匙蜜酥煎」「六钱木香化滞汤」「一两益阴肾气丸」
    if (/[一二三四五六七八九十百半两斤匙钱合]/.test(name)) return false
    // 「大小和中饮」并称非独立方
    if (/^大小/.test(name)) return false
    return true
  })

  // 理隂煎 / 理阴煎 合并为一条
  const byNorm = new Map<string, Formula>()
  const deduped: Formula[] = []
  for (const formula of kept) {
    const key = normalizeName(formula.name)
    const existing = byNorm.get(key)
    if (existing) {
      if (formula.herbs.length > existing.herbs.length) {
        existing.herbs = formula.herbs.map((herb) => ({ ...herb }))
        existing.preparation = formula.preparation || existing.preparation
        existing.chapter = existing.chapter || formula.chapter
      }
      continue
    }
    formula.name = key
    byNorm.set(key, formula)
    deduped.push(formula)
  }
  baseFormulas.length = 0
  baseFormulas.push(...deduped)

  const byName = new Map(baseFormulas.map((formula) => [formula.name, formula]))
  for (const block of fangzhen) {
    const key = normalizeName(block.name)
    const existing = byName.get(key)
    if (existing) {
      if (existing.herbs.length < block.herbs.length) {
        existing.herbs = block.herbs.map((herb) => ({ ...herb }))
        existing.preparation = block.preparation || existing.preparation
        existing.chapter = existing.chapter || block.chapter
      }
      continue
    }
    const formula: Formula = {
      id: `${BOOK_ID}-formula-${key}`,
      name: key,
      book: BOOK_ID,
      herbs: block.herbs.map((herb) => ({ ...herb })),
      preparation: block.preparation,
      modifications: [],
      sourceClauseIds: [],
      chapter: block.chapter,
      doseSystem: 'qing',
    }
    baseFormulas.push(formula)
    byName.set(key, formula)
  }

  const outDir = path.join(root, 'data', 'parsed')
  await ensureDir(outDir)
  await writeJson(path.join(outDir, `${BOOK_ID}.json`), {
    clauses,
    formulas: baseFormulas,
  })

  return {
    clauses,
    formulas: baseFormulas,
    stats: {
      chapterCount: sections.length,
      clauseCount: clauses.length,
      formulaCount: baseFormulas.length,
      withHerbs: baseFormulas.filter((formula) => formula.herbs.length > 0).length,
      truncated,
    },
  }
}
