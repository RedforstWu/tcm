import path from 'node:path'
import type { BookId, Clause, Formula } from '../../src/types/data.ts'
import {
  buildClausesFromSections,
  splitParagraphs,
  type WikiSection,
} from '../lib/generic-wiki-parse.ts'
import { ensureDir, projectRoot, readText, writeJson } from '../lib/fs-utils.ts'
import { splitSkqsVolumes } from '../lib/skqs-wiki.ts'

const BOOK_ID = 'mingyi' as BookId
const RAW_FILENAME = 'mingyi-leian.wiki'
/** 每卷最多条文数；分卷后可提高 */
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
 * 《名医类案》：按 SUBPAGE / SKQS header 分卷，段落为条文；方名粗提取。
 */
export async function runMingyiParse(): Promise<{
  clauses: Clause[]
  formulas: Formula[]
  stats: {
    chapterCount: number
    clauseCount: number
    formulaCount: number
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
  const { clauses, formulas } = buildClausesFromSections({
    bookId: BOOK_ID,
    sections: limited,
    splitIntoParagraphs: true,
  })

  const outDir = path.join(root, 'data', 'parsed')
  await ensureDir(outDir)
  await writeJson(path.join(outDir, `${BOOK_ID}.json`), { clauses, formulas })

  return {
    clauses,
    formulas,
    stats: {
      chapterCount: sections.length,
      clauseCount: clauses.length,
      formulaCount: formulas.length,
      truncated,
    },
  }
}
