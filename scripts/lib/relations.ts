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

const CHENFU_BOOKS = new Set(['bianzheng', 'shishi', 'funvke', 'funanke'])

function sameDiffScope(left: Formula, right: Formula): boolean {
  if (left.book === right.book) return true
  // 伤寒 ↔ 金匮
  if (
    (left.book === 'songben' || left.book === 'jingui') &&
    (right.book === 'songben' || right.book === 'jingui')
  ) {
    return true
  }
  // 陈傅内部跨书（女科/辨证录等同方体系）
  if (CHENFU_BOOKS.has(left.book) && CHENFU_BOOKS.has(right.book)) {
    return true
  }
  return false
}

export function computeDiffPairs(formulas: Formula[], clauses: Clause[]): FormulaDiffPair[] {
  const pairs: FormulaDiffPair[] = []
  for (let i = 0; i < formulas.length; i += 1) {
    for (let j = i + 1; j < formulas.length; j += 1) {
      const left = formulas[i]!
      const right = formulas[j]!
      if (!sameDiffScope(left, right)) {
        if (left.name === right.name) {
          // 同名跨体系不在此比较
        } else {
          continue
        }
      }
      // 经方与陈傅不互比
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

      const symptomsA = clauseSymptoms(clauses, left.sourceClauseIds)
      const symptomsB = clauseSymptoms(clauses, right.sourceClauseIds)

      if (onlyA.length === 1 && onlyB.length === 0) {
        const herbId = onlyA[0]!
        const herbName = left.herbs.find((herb) => herb.herbId === herbId)?.name ?? herbId
        pairs.push({
          id: `${left.id}__remove__${right.id}__${herbId}`,
          fromId: left.id,
          toId: right.id,
          kind: 'remove',
          herbId,
          herbName,
          fromDoseRaw: dosesA.get(herbId),
          symptomDelta: {
            gained: [...symptomsB].filter((tag) => !symptomsA.has(tag)),
            lost: [...symptomsA].filter((tag) => !symptomsB.has(tag)),
          },
          fromClauseIds: left.sourceClauseIds,
          toClauseIds: right.sourceClauseIds,
        })
      } else if (onlyB.length === 1 && onlyA.length === 0) {
        const herbId = onlyB[0]!
        const herbName = right.herbs.find((herb) => herb.herbId === herbId)?.name ?? herbId
        pairs.push({
          id: `${left.id}__add__${right.id}__${herbId}`,
          fromId: left.id,
          toId: right.id,
          kind: 'add',
          herbId,
          herbName,
          toDoseRaw: dosesB.get(herbId),
          symptomDelta: {
            gained: [...symptomsB].filter((tag) => !symptomsA.has(tag)),
            lost: [...symptomsA].filter((tag) => !symptomsB.has(tag)),
          },
          fromClauseIds: left.sourceClauseIds,
          toClauseIds: right.sourceClauseIds,
        })
      } else if (onlyA.length === 0 && onlyB.length === 0) {
        const doseChanged = [...setA].filter((id) => (dosesA.get(id) ?? '') !== (dosesB.get(id) ?? ''))
        if (doseChanged.length === 1) {
          const herbId = doseChanged[0]!
          const herbName = left.herbs.find((herb) => herb.herbId === herbId)?.name ?? herbId
          pairs.push({
            id: `${left.id}__dose__${right.id}__${herbId}`,
            fromId: left.id,
            toId: right.id,
            kind: 'dose',
            herbId,
            herbName,
            fromDoseRaw: dosesA.get(herbId),
            toDoseRaw: dosesB.get(herbId),
            symptomDelta: {
              gained: [...symptomsB].filter((tag) => !symptomsA.has(tag)),
              lost: [...symptomsA].filter((tag) => !symptomsB.has(tag)),
            },
            fromClauseIds: left.sourceClauseIds,
            toClauseIds: right.sourceClauseIds,
          })
        }
      }
    }
  }
  return pairs
}

export function computeFamilies(formulas: Formula[]): FormulaFamily[] {
  const families: FormulaFamily[] = []
  const assigned = new Set<string>()

  // 命名规则：桂枝加X / 桂枝去X / 某某加X
  const byBase = new Map<string, Formula[]>()
  for (const formula of formulas) {
    const baseMatch = formula.name.match(/^(.+?)(?:加|去)(.+)$/)
    const baseName = baseMatch?.[1]?.replace(/汤$/, '汤') ?? formula.name
    const normalizedBase = /汤|散|丸|膏|煎|饮$/.test(baseName) ? baseName : formula.name
    const list = byBase.get(normalizedBase) ?? []
    list.push(formula)
    byBase.set(normalizedBase, list)
  }

  for (const [baseName, list] of byBase) {
    if (list.length < 2) continue
    const base =
      list.find((item) => item.name === baseName) ??
      list.slice().sort((a, b) => a.herbs.length - b.herbs.length)[0]!
    const family: FormulaFamily = {
      id: `family-${baseName}`,
      name: `${baseName}类`,
      baseFormulaId: base.id,
      formulaIds: list.map((item) => item.id),
    }
    families.push(family)
    for (const item of list) {
      item.familyId = family.id
      assigned.add(item.id)
    }
  }

  // Jaccard 聚类补充
  for (const formula of formulas) {
    if (assigned.has(formula.id) || formula.herbs.length === 0) continue
    const members = [formula]
    const setA = herbSet(formula)
    for (const other of formulas) {
      if (other.id === formula.id || assigned.has(other.id) || other.herbs.length === 0) continue
      if (jaccard(setA, herbSet(other)) >= 0.6) members.push(other)
    }
    if (members.length < 2) continue
    const family: FormulaFamily = {
      id: `family-sim-${formula.name}`,
      name: `${formula.name}相近方`,
      baseFormulaId: formula.id,
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
