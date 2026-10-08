import type { Formula, FormulaDiffPair, FormulaFamily, Clause } from '../../src/types/data.ts'

function herbSet(formula: Formula): Set<string> {
  return new Set(formula.herbs.map((herb) => herb.herbId))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const item of a) if (b.has(item)) inter += 1
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function doseMap(formula: Formula): Map<string, string> {
  return new Map(
    formula.herbs.map((herb) => [
      herb.herbId,
      herb.doseQian !== undefined ? `qian:${herb.doseQian}` : herb.doseRaw,
    ]),
  )
}

function clauseSymptoms(clauses: Clause[], ids: string[]): Set<string> {
  const tags = new Set<string>()
  for (const id of ids) {
    const clause = clauses.find((item) => item.id === id)
    if (!clause) continue
    for (const tag of clause.symptomTags) tags.add(tag)
  }
  return tags
}

function herbNameOf(formula: Formula, herbId: string): string {
  return formula.herbs.find((herb) => herb.herbId === herbId)?.name ?? herbId
}

const CHENFU_BOOKS = new Set(['bianzheng', 'shishi', 'funvke', 'funanke'])
const JINGFANG_BOOKS = new Set(['songben', 'jingui', 'guilin'])

function sameDiffScope(left: Formula, right: Formula): boolean {
  if (left.book === right.book) return true
  // 经方三书（宋本 / 金匮 / 桂林）互比
  if (JINGFANG_BOOKS.has(left.book) && JINGFANG_BOOKS.has(right.book)) return true
  // 陈傅内部跨书
  if (CHENFU_BOOKS.has(left.book) && CHENFU_BOOKS.has(right.book)) return true
  return false
}

const MAX_MULTI_HERB_CHANGES = 5

export function computeDiffPairs(formulas: Formula[], clauses: Clause[]): FormulaDiffPair[] {
  const pairs: FormulaDiffPair[] = []
  for (let i = 0; i < formulas.length; i += 1) {
    for (let j = i + 1; j < formulas.length; j += 1) {
      const left = formulas[i]!
      const right = formulas[j]!
      if (!sameDiffScope(left, right)) continue
      const leftChenfu = CHENFU_BOOKS.has(left.book)
      const rightChenfu = CHENFU_BOOKS.has(right.book)
      if (leftChenfu !== rightChenfu) continue
      const setA = herbSet(left)
      const setB = herbSet(right)
      if (setA.size === 0 || setB.size === 0) continue

      const onlyA = [...setA].filter((id) => !setB.has(id))
      const onlyB = [...setB].filter((id) => !setA.has(id))
      const dosesA = doseMap(left)
      const dosesB = doseMap(right)
      const doseChanged = [...setA].filter(
        (id) => setB.has(id) && (dosesA.get(id) ?? '') !== (dosesB.get(id) ?? ''),
      )

      const symptomsA = clauseSymptoms(clauses, left.sourceClauseIds)
      const symptomsB = clauseSymptoms(clauses, right.sourceClauseIds)
      const symptomDelta = {
        gained: [...symptomsB].filter((tag) => !symptomsA.has(tag)),
        lost: [...symptomsA].filter((tag) => !symptomsB.has(tag)),
      }

      const changedCount = onlyA.length + onlyB.length
      const sharedCount = [...setA].filter((id) => setB.has(id)).length
      // 多味变化：至少共有一味，且差异不太大
      if (changedCount > MAX_MULTI_HERB_CHANGES) continue
      if (changedCount > 1 && sharedCount === 0) continue
      if (changedCount > 1 && jaccard(setA, setB) < 0.2 && sharedCount < 2) continue

      if (onlyA.length === 1 && onlyB.length === 0 && doseChanged.length === 0) {
        const herbId = onlyA[0]!
        pairs.push({
          id: `${left.id}__remove__${right.id}__${herbId}`,
          fromId: left.id,
          toId: right.id,
          kind: 'remove',
          herbId,
          herbName: herbNameOf(left, herbId),
          fromDoseRaw: dosesA.get(herbId),
          symptomDelta,
          fromClauseIds: left.sourceClauseIds,
          toClauseIds: right.sourceClauseIds,
        })
      } else if (onlyB.length === 1 && onlyA.length === 0 && doseChanged.length === 0) {
        const herbId = onlyB[0]!
        pairs.push({
          id: `${left.id}__add__${right.id}__${herbId}`,
          fromId: left.id,
          toId: right.id,
          kind: 'add',
          herbId,
          herbName: herbNameOf(right, herbId),
          toDoseRaw: dosesB.get(herbId),
          symptomDelta,
          fromClauseIds: left.sourceClauseIds,
          toClauseIds: right.sourceClauseIds,
        })
      } else if (onlyA.length === 0 && onlyB.length === 0 && doseChanged.length === 1) {
        const herbId = doseChanged[0]!
        pairs.push({
          id: `${left.id}__dose__${right.id}__${herbId}`,
          fromId: left.id,
          toId: right.id,
          kind: 'dose',
          herbId,
          herbName: herbNameOf(left, herbId),
          fromDoseRaw: dosesA.get(herbId),
          toDoseRaw: dosesB.get(herbId),
          symptomDelta,
          fromClauseIds: left.sourceClauseIds,
          toClauseIds: right.sourceClauseIds,
        })
      } else if (changedCount >= 1 || doseChanged.length >= 1) {
        const removedNames = onlyA.map((id) => herbNameOf(left, id))
        const addedNames = onlyB.map((id) => herbNameOf(right, id))
        const doseNames = doseChanged.map((id) => herbNameOf(left, id))
        const parts: string[] = []
        if (addedNames.length) parts.push(`加${addedNames.join('、')}`)
        if (removedNames.length) parts.push(`去${removedNames.join('、')}`)
        if (doseNames.length) parts.push(`改${doseNames.join('、')}`)
        pairs.push({
          id: `${left.id}__multi__${right.id}`,
          fromId: left.id,
          toId: right.id,
          kind: 'multi',
          herbId: [...onlyA, ...onlyB, ...doseChanged].join('+'),
          herbName: parts.join('') || '多味异',
          addedHerbNames: addedNames,
          removedHerbNames: removedNames,
          symptomDelta,
          fromClauseIds: left.sourceClauseIds,
          toClauseIds: right.sourceClauseIds,
        })
      }
    }
  }
  return pairs
}

/** 「桂枝加附子汤」→「桂枝汤」；「四逆加人参汤」→「四逆汤」 */
export function extractFamilyBaseName(name: string): string {
  const addRemove = name.match(/^(.+?)(?:加|去)(.+)$/)
  if (!addRemove) return name
  let base = addRemove[1]!
  if (!/(?:汤|散|丸|膏|煎|饮)$/.test(base)) {
    base = `${base}汤`
  }
  return base
}

function pickBaseFormula(members: Formula[], baseName: string): Formula {
  return (
    members.find((item) => item.book === 'songben' && item.name === baseName) ??
    members.find((item) => item.name === baseName) ??
    members.find((item) => item.book === 'songben') ??
    members.slice().sort((a, b) => a.herbs.length - b.herbs.length)[0]!
  )
}

function computeFamiliesInGroup(formulas: Formula[]): FormulaFamily[] {
  const families: FormulaFamily[] = []
  const assigned = new Set<string>()
  const nameSet = new Set(formulas.map((item) => item.name))

  const byBase = new Map<string, Formula[]>()
  for (const formula of formulas) {
    let baseName = extractFamilyBaseName(formula.name)
    if (!nameSet.has(baseName)) {
      if (baseName === '柴胡汤' && nameSet.has('小柴胡汤')) {
        baseName = '小柴胡汤'
      }
    }
    const list = byBase.get(baseName) ?? []
    list.push(formula)
    byBase.set(baseName, list)
  }

  for (const [baseName, list] of byBase) {
    const extras = formulas.filter(
      (item) => item.name === baseName && !list.some((member) => member.id === item.id),
    )
    const members = [...list, ...extras]
    if (members.length < 2) continue
    const base = pickBaseFormula(members, baseName)
    const family: FormulaFamily = {
      id: `family-${baseName}`,
      name: `${baseName}类`,
      baseFormulaId: base.id,
      formulaIds: [...new Set(members.map((item) => item.id))],
    }
    families.push(family)
    for (const item of members) {
      item.familyId = family.id
      assigned.add(item.id)
    }
  }

  for (const formula of formulas) {
    if (assigned.has(formula.id) || formula.herbs.length === 0) continue
    const members = [formula]
    const setA = herbSet(formula)
    for (const other of formulas) {
      if (other.id === formula.id || assigned.has(other.id) || other.herbs.length === 0) continue
      if (jaccard(setA, herbSet(other)) >= 0.6) members.push(other)
    }
    if (members.length < 2) continue
    const base = pickBaseFormula(members, formula.name)
    const family: FormulaFamily = {
      id: `family-sim-${formula.name}`,
      name: `${formula.name}相近方`,
      baseFormulaId: base.id,
      formulaIds: members.map((item) => item.id),
    }
    families.push(family)
    for (const item of members) {
      item.familyId = family.id
      assigned.add(item.id)
    }
  }

  return families
}

export function computeFamilies(formulas: Formula[]): FormulaFamily[] {
  const jingfang = formulas.filter((item) => JINGFANG_BOOKS.has(item.book))
  const chenfu = formulas.filter((item) => CHENFU_BOOKS.has(item.book))
  const others = formulas.filter(
    (item) => !JINGFANG_BOOKS.has(item.book) && !CHENFU_BOOKS.has(item.book),
  )
  return [
    ...computeFamiliesInGroup(jingfang),
    ...computeFamiliesInGroup(chenfu),
    ...computeFamiliesInGroup(others),
  ]
}
