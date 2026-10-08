import path from 'node:path'
import type {
  BookId,
  Clause,
  Corpus,
  CrossLink,
  DatasetIndex,
  Formula,
  Herb,
  HerbMonograph,
  HerbRole,
  SearchDoc,
} from '../src/types/data.ts'
import { BOOK_CORPUS as CORPUS_MAP } from '../src/types/data.ts'
import { alignChenfuParallels, alignSongbenToGuilin } from './lib/align.ts'
import { annotateClauses } from './lib/annotate.ts'
import { extractHerbRolesFromFangjie } from './lib/fangjie.ts'
import { ensureDir, fileExists, projectRoot, readText, writeJson } from './lib/fs-utils.ts'
import { computeDiffPairs, computeFamilies } from './lib/relations.ts'
import { runGuilinParse } from './parse/guilin.ts'
import { runJinguiParse } from './parse/jingui.ts'
import { runSongbenParse } from './parse/songben.ts'
import { runBianzhengParse } from './parse/bianzheng.ts'
import { runFunvkeParse } from './parse/funvke.ts'
import { runFunankeParse } from './parse/funanke.ts'
import { runShishiParse } from './parse/shishi.ts'
import { runBencaoParse } from './parse/bencao.ts'

function ensureMentionedFormulas(clauses: Clause[], formulas: Formula[]): Formula[] {
  const existing = new Set(formulas.map((formula) => `${formula.book}:${formula.name}`))
  const extras: Formula[] = []
  for (const clause of clauses) {
    const names = clause.text.match(/([\u4e00-\u9fff]{2,12}(?:汤|散|丸|膏|煎|饮))(?:主之|方)/g)
    if (!names) continue
    for (const raw of names) {
      const name = raw.replace(/(?:主之|方)$/, '')
      const key = `${clause.book}:${name}`
      if (existing.has(key)) {
        const formula = formulas.find((item) => item.book === clause.book && item.name === name)
        if (formula && !formula.sourceClauseIds.includes(clause.id)) {
          formula.sourceClauseIds.push(clause.id)
          if (!clause.formulaIds.includes(formula.id)) clause.formulaIds.push(formula.id)
        }
        continue
      }
      const id = `${clause.book}-formula-${name}`
      const formula: Formula = {
        id,
        name,
        book: clause.book,
        herbs: [],
        preparation: '',
        modifications: [],
        sourceClauseIds: [clause.id],
        chapter: clause.chapter,
      }
      extras.push(formula)
      existing.add(key)
      clause.formulaIds.push(id)
    }
  }
  return [...formulas, ...extras]
}

function mergeFormulaHerbs(formulas: Formula[]): Formula[] {
  const byName = new Map<string, Formula>()
  for (const formula of formulas) {
    const existing = byName.get(formula.name)
    if (!existing) {
      byName.set(formula.name, { ...formula, herbs: [...formula.herbs] })
      continue
    }
    if (existing.herbs.length === 0 && formula.herbs.length > 0) {
      existing.herbs = formula.herbs
      existing.preparation = formula.preparation || existing.preparation
      existing.modifications =
        formula.modifications.length > 0 ? formula.modifications : existing.modifications
    }
    for (const clauseId of formula.sourceClauseIds) {
      if (!existing.sourceClauseIds.includes(clauseId)) {
        existing.sourceClauseIds.push(clauseId)
      }
    }
  }
  return formulas.map((formula) => {
    if (formula.herbs.length > 0) return formula
    const donor = byName.get(formula.name)
    if (!donor || donor.herbs.length === 0) return formula
    return {
      ...formula,
      herbs: donor.herbs,
      preparation: formula.preparation || donor.preparation,
      modifications:
        formula.modifications.length > 0 ? formula.modifications : donor.modifications,
    }
  })
}

function buildHerbs(formulas: Formula[], monographs: HerbMonograph[]): Herb[] {
  const map = new Map<string, Herb>()
  for (const formula of formulas) {
    const corpus = CORPUS_MAP[formula.book]
    for (const herb of formula.herbs) {
      const current = map.get(herb.herbId) ?? {
        id: herb.herbId,
        name: herb.name,
        aliases: [],
        formulaIds: [],
        frequency: 0,
        formulaIdsByCorpus: {},
      }
      current.frequency += 1
      if (!current.formulaIds.includes(formula.id)) current.formulaIds.push(formula.id)
      const byCorpus = current.formulaIdsByCorpus ?? {}
      const list = byCorpus[corpus] ?? []
      if (!list.includes(formula.id)) list.push(formula.id)
      byCorpus[corpus] = list
      current.formulaIdsByCorpus = byCorpus
      map.set(herb.herbId, current)
    }
  }
  for (const mono of monographs) {
    const current = map.get(mono.herbId) ?? {
      id: mono.herbId,
      name: mono.name,
      aliases: [],
      formulaIds: [],
      frequency: 0,
      formulaIdsByCorpus: {},
    }
    current.monographId = mono.id
    map.set(mono.herbId, current)
  }
  return [...map.values()].sort((a, b) => b.frequency - a.frequency)
}

function buildSearchDocs(
  clauses: Clause[],
  formulas: Formula[],
  herbs: Herb[],
  monographs: HerbMonograph[],
): SearchDoc[] {
  const docs: SearchDoc[] = []
  for (const clause of clauses) {
    docs.push({
      id: clause.id,
      type: 'clause',
      title: `${clause.book}·${clause.heading ?? clause.chapter}·${clause.order}`,
      text: clause.text,
      book: clause.book,
      corpus: CORPUS_MAP[clause.book],
      href: `/read/${clause.book}?clause=${clause.id}`,
    })
  }
  for (const formula of formulas) {
    docs.push({
      id: formula.id,
      type: 'formula',
      title: formula.name,
      text: `${formula.name} ${formula.herbs.map((herb) => herb.name).join(' ')} ${formula.preparation} ${formula.fangjie ?? ''}`,
      book: formula.book,
      corpus: CORPUS_MAP[formula.book],
      href: `/formulas/${encodeURIComponent(formula.id)}`,
    })
    if (formula.fangjie) {
      docs.push({
        id: `${formula.id}-fangjie`,
        type: 'fangjie',
        title: `${formula.name}方解`,
        text: formula.fangjie,
        book: formula.book,
        corpus: CORPUS_MAP[formula.book],
        href: `/formulas/${encodeURIComponent(formula.id)}`,
      })
    }
  }
  for (const herb of herbs) {
    docs.push({
      id: herb.id,
      type: 'herb',
      title: herb.name,
      text: `${herb.name} ${herb.aliases.join(' ')}`,
      href: `/herbs/${encodeURIComponent(herb.id)}`,
    })
  }
  for (const mono of monographs) {
    docs.push({
      id: mono.id,
      type: 'monograph',
      title: `本草新编·${mono.name}`,
      text: `${mono.name} ${mono.summary}`,
      book: 'bencao',
      corpus: 'chenfu',
      href: `/herbs/${encodeURIComponent(mono.herbId)}`,
    })
  }
  return docs
}

function collectRuleRoles(formulas: Formula[]): HerbRole[] {
  const roles: HerbRole[] = []
  for (const formula of formulas) {
    if (!formula.fangjie) continue
    const extracted = extractHerbRolesFromFangjie({
      formulaId: formula.id,
      fangjie: formula.fangjie,
      herbIds: formula.herbs.map((h) => h.herbId),
      herbNames: formula.herbs.map((h) => h.name),
    })
    roles.push(...extracted)
  }
  return roles
}

async function loadLlmEnrichment(): Promise<{
  roles: HerbRole[]
  clauseTags: Map<string, { symptomTags: string[]; pathogenesisTags: string[]; misjudgment?: Clause['misjudgment'] }>
}> {
  const root = projectRoot()
  const books = ['funvke', 'funanke', 'bianzheng', 'shishi']
  const roles: HerbRole[] = []
  const clauseTags = new Map<
    string,
    { symptomTags: string[]; pathogenesisTags: string[]; misjudgment?: Clause['misjudgment'] }
  >()

  for (const book of books) {
    const cachePath = path.join(root, 'data', 'annotations', 'chenfu-llm', `${book}.json`)
    if (!(await fileExists(cachePath))) continue
    try {
      const payload = JSON.parse(await readText(cachePath)) as {
        entries?: Array<{
          clauseId: string
          symptomTags?: string[]
          pathogenesisTags?: string[]
          misjudgment?: Clause['misjudgment']
          herbRoles?: HerbRole[]
        }>
      }
      for (const entry of payload.entries ?? []) {
        clauseTags.set(entry.clauseId, {
          symptomTags: entry.symptomTags ?? [],
          pathogenesisTags: entry.pathogenesisTags ?? [],
          misjudgment: entry.misjudgment,
        })
        for (const role of entry.herbRoles ?? []) {
          roles.push(role)
        }
      }
    } catch (error) {
      console.warn(`[build] skip llm cache ${book}:`, error)
    }
  }
  return { roles, clauseTags }
}

function mergeRoles(ruleRoles: HerbRole[], llmRoles: HerbRole[]): HerbRole[] {
  const map = new Map<string, HerbRole>()
  // 规则优先
  for (const role of ruleRoles) {
    map.set(`${role.formulaId}|${role.herbId}|${role.roleText}`, role)
  }
  for (const role of llmRoles) {
    const key = `${role.formulaId}|${role.herbId}|${role.roleText}`
    if (!map.has(key)) {
      // 同方同药已有规则结果时跳过 llm
      const hasRule = [...map.keys()].some((k) => k.startsWith(`${role.formulaId}|${role.herbId}|`))
      if (hasRule) continue
      map.set(key, role)
    }
  }
  return [...map.values()]
}

function buildCrossLinks(formulas: Formula[]): CrossLink[] {
  const byName = new Map<string, Formula>()
  for (const formula of formulas) {
    if (CORPUS_MAP[formula.book] === 'jingfang') {
      byName.set(formula.name, formula)
    }
  }
  const links: CrossLink[] = []
  for (const formula of formulas) {
    if (CORPUS_MAP[formula.book] !== 'chenfu') continue
    for (const derived of formula.derivedFrom ?? []) {
      const jf = byName.get(derived.name)
      links.push({
        id: `${formula.id}__${derived.name}`,
        chenfuFormulaId: formula.id,
        derivedName: derived.name,
        jingfangFormulaId: jf?.id,
        sourceSentence: formula.fangjie?.slice(0, 80),
      })
      if (jf) {
        derived.formulaId = jf.id
      }
    }
  }
  return links
}

function bookMeta(
  id: BookId,
  title: string,
  clauses: Clause[],
  formulas: Formula[],
): DatasetIndex['books'][number] {
  return {
    id,
    title,
    corpus: CORPUS_MAP[id],
    clauseCount: clauses.length,
    formulaCount: formulas.filter((f) => f.book === id).length,
    chapterCount: new Set(clauses.map((c) => c.chapter)).size,
  }
}

async function main(): Promise<void> {
  const root = projectRoot()
  const outDir = path.join(root, 'public', 'data')
  await ensureDir(outDir)

  console.log('[build] parsing sources...')
  const songben = await runSongbenParse()
  const jingui = await runJinguiParse()
  const guilin = await runGuilinParse()
  const funvke = await runFunvkeParse()
  const funanke = await runFunankeParse()
  const bianzheng = await runBianzhengParse()
  const shishi = await runShishiParse()
  const bencao = await runBencaoParse()

  let clauses = annotateClauses([
    ...songben.clauses,
    ...jingui.clauses,
    ...guilin.clauses,
    ...funvke.clauses,
    ...funanke.clauses,
    ...bianzheng.clauses,
    ...shishi.clauses,
  ])

  let formulas = mergeFormulaHerbs(
    ensureMentionedFormulas(clauses, [
      ...songben.formulas,
      ...jingui.formulas,
      ...guilin.formulas,
      ...funvke.formulas,
      ...funanke.formulas,
      ...bianzheng.formulas,
      ...shishi.formulas,
    ]),
  )

  console.log('[build] aligning songben ↔ guilin...')
  const songbenClauses = clauses.filter((clause) => clause.book === 'songben')
  const guilinClauses = clauses.filter((clause) => clause.book === 'guilin')
  const { alignments, uniqueGuilinIds } = alignSongbenToGuilin(songbenClauses, guilinClauses)
  const alignedMap = new Map(
    alignments.filter((item) => item.guilinId).map((item) => [item.songbenId, item.guilinId!]),
  )
  clauses = clauses.map((clause) =>
    clause.book === 'songben' && alignedMap.has(clause.id)
      ? { ...clause, alignedGuilinId: alignedMap.get(clause.id) }
      : clause,
  )

  console.log('[build] aligning chenfu parallels...')
  const funvkeClauses = clauses.filter((c) => c.book === 'funvke')
  const funankeClauses = clauses.filter((c) => c.book === 'funanke')
  const bianzhengClauses = clauses.filter((c) => c.book === 'bianzheng')
  const shishiClauses = clauses.filter((c) => c.book === 'shishi')
  // 辨证录妇人相关章
  const bianzhengWomen = bianzhengClauses.filter((c) =>
    /妇人|带下|月经|种子|妊娠|产后|乳|崩|经/.test(c.chapter + (c.heading ?? '')),
  )
  const nvkeAlign = alignChenfuParallels(funvkeClauses, bianzhengWomen.length > 0 ? bianzhengWomen : bianzhengClauses)
  const nankeAlign = alignChenfuParallels(funankeClauses, [...bianzhengClauses, ...shishiClauses])

  console.log('[build] loading llm enrichment + rule fangjie...')
  const llm = await loadLlmEnrichment()
  // 回写条款标签
  clauses = clauses.map((clause) => {
    const tags = llm.clauseTags.get(clause.id)
    if (!tags) return clause
    return {
      ...clause,
      symptomTags: tags.symptomTags.length > 0 ? tags.symptomTags : clause.symptomTags,
      pathogenesisTags:
        tags.pathogenesisTags.length > 0 ? tags.pathogenesisTags : clause.pathogenesisTags,
      misjudgment: tags.misjudgment ?? clause.misjudgment,
      reviewStatus: 'ai-draft' as const,
    }
  })

  const ruleRoles = collectRuleRoles(formulas.filter((f) => CORPUS_MAP[f.book] === 'chenfu'))
  const herbRoles = mergeRoles(ruleRoles, llm.roles)

  console.log('[build] computing relations...')
  const families = computeFamilies(formulas)
  const familyMap = new Map(families.flatMap((family) => family.formulaIds.map((id) => [id, family.id])))
  formulas = formulas.map((formula) => ({
    ...formula,
    familyId: familyMap.get(formula.id) ?? formula.familyId,
  }))

  const jingfangDiffs = computeDiffPairs(
    formulas.filter((f) => f.book === 'songben' || f.book === 'jingui'),
    clauses,
  )
  const chenfuDiffs = computeDiffPairs(
    formulas.filter((f) => ['bianzheng', 'shishi', 'funvke', 'funanke'].includes(f.book)),
    clauses,
  )
  const diffPairs = [...jingfangDiffs, ...chenfuDiffs]
  const crossLinks = buildCrossLinks(formulas)
  const monographs = bencao.monographs
  const herbs = buildHerbs(formulas, monographs)
  const searchDocs = buildSearchDocs(clauses, formulas, herbs, monographs)

  const index: DatasetIndex = {
    books: [
      bookMeta('songben', '宋本伤寒论', songben.clauses, formulas),
      bookMeta('jingui', '金匮要略', jingui.clauses, formulas),
      bookMeta('guilin', '桂林古本伤寒杂病论', guilin.clauses, formulas),
      bookMeta('funvke', '傅青主女科', funvke.clauses, formulas),
      bookMeta('funanke', '傅青主男科', funanke.clauses, formulas),
      bookMeta('bianzheng', '辨证录', bianzheng.clauses, formulas),
      bookMeta('shishi', '石室秘录', shishi.clauses, formulas),
      {
        id: 'bencao',
        title: '本草新编',
        corpus: 'chenfu' as Corpus,
        clauseCount: 0,
        formulaCount: 0,
        chapterCount: 0,
      },
    ],
    herbCount: herbs.length,
    formulaCount: formulas.length,
    clauseCount: clauses.length,
    diffPairCount: diffPairs.length,
    herbRoleCount: herbRoles.length,
    monographCount: monographs.length,
    generatedAt: new Date().toISOString(),
    sources: [
      { id: 'songben', title: '宋本伤寒论（赵开美本）', url: 'https://zh.wikisource.org/zh-hans/傷寒論' },
      { id: 'jingui', title: '金匮要略', url: 'https://zh.wikisource.org/zh-hans/金匱要略' },
      { id: 'guilin', title: '桂林古本伤寒杂病论', url: 'https://zh.wikisource.org/zh-hans/傷寒雜病論_(桂林古本)' },
      { id: 'funvke', title: '傅青主女科', url: 'https://zh.wikisource.org/zh-hans/傅青主女科' },
      { id: 'funanke', title: '傅青主男科', url: 'https://zh.wikisource.org/zh-hans/傅青主男科' },
      { id: 'bianzheng', title: '辨证录', url: 'https://zh.wikisource.org/zh-hans/辨證錄' },
      { id: 'shishi', title: '石室秘录', url: 'https://zh.wikisource.org/zh-hans/石室秘錄' },
      { id: 'bencao', title: '本草新编', url: 'https://zh.wikisource.org/zh-hans/本草新編' },
    ],
  }

  const writeBook = async (book: BookId) => {
    await writeJson(
      path.join(outDir, `clauses-${book}.json`),
      clauses.filter((c) => c.book === book),
    )
  }

  await writeJson(path.join(outDir, 'index.json'), index)
  for (const book of ['songben', 'jingui', 'guilin', 'funvke', 'funanke', 'bianzheng', 'shishi'] as BookId[]) {
    await writeBook(book)
  }
  await writeJson(path.join(outDir, 'formulas.json'), formulas)
  await writeJson(path.join(outDir, 'herbs.json'), herbs)
  await writeJson(path.join(outDir, 'diff-pairs.json'), diffPairs)
  await writeJson(path.join(outDir, 'families.json'), families)
  await writeJson(path.join(outDir, 'alignments.json'), { alignments, uniqueGuilinIds })
  await writeJson(path.join(outDir, 'parallels.json'), { nvkeAlign, nankeAlign })
  await writeJson(path.join(outDir, 'herb-roles.json'), herbRoles)
  await writeJson(path.join(outDir, 'herb-monographs.json'), monographs)
  await writeJson(path.join(outDir, 'cross-links.json'), crossLinks)
  await writeJson(path.join(outDir, 'search-docs.json'), searchDocs)
  await writeJson(path.join(outDir, 'validation.json'), {
    songben: songben.validation,
    jingui: jingui.stats,
    guilin: guilin.stats,
    funvke: funvke.stats,
    funanke: funanke.stats,
    bianzheng: bianzheng.stats,
    shishi: shishi.stats,
    bencao: bencao.stats,
    herbRoles: { rule: ruleRoles.length, llm: llm.roles.length, merged: herbRoles.length },
    note: '证候标签与方解作用含规则/大模型草稿（ai-draft），需人工校对',
  })

  console.log(
    `[build] done clauses=${clauses.length} formulas=${formulas.length} herbs=${herbs.length} diffs=${diffPairs.length} roles=${herbRoles.length} mono=${monographs.length}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
