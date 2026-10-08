import type { DiffKind, Formula } from '@/types/data'

export interface FormulaHerbDelta {
  herbId: string
  herbName: string
  fromDoseRaw?: string
  toDoseRaw?: string
}

export interface FormulaRelation {
  fromId: string
  toId: string
  kind: DiffKind
  /** 短标签，如「加·附子」「多·加龙牡去芍」 */
  label: string
  added: FormulaHerbDelta[]
  removed: FormulaHerbDelta[]
  doseChanged: FormulaHerbDelta[]
}

function herbSet(formula: Formula): Map<string, { name: string; doseRaw: string }> {
  const map = new Map<string, { name: string; doseRaw: string }>()
  for (const herb of formula.herbs) {
    map.set(herb.herbId, { name: herb.name, doseRaw: herb.doseRaw })
  }
  return map
}

function joinNames(items: FormulaHerbDelta[], limit = 3): string {
  const names = items.map((item) => item.herbName)
  if (names.length <= limit) return names.join('、')
  return `${names.slice(0, limit).join('、')}等${names.length}味`
}

/** 比较两方组成，生成一条关系（可含多味加减/改剂量） */
export function compareFormulas(from: Formula, to: Formula): FormulaRelation | null {
  if (from.id === to.id) return null
  const mapA = herbSet(from)
  const mapB = herbSet(to)
  if (mapA.size === 0 && mapB.size === 0) return null
  // 一方无组成时仍连「异本/缺载」边
  if (mapA.size === 0 || mapB.size === 0) {
    return {
      fromId: from.id,
      toId: to.id,
      kind: 'multi',
      label: mapB.size === 0 ? '缺载' : '异本',
      added: [...mapB.entries()].map(([herbId, item]) => ({
        herbId,
        herbName: item.name,
        toDoseRaw: item.doseRaw,
      })),
      removed: [...mapA.entries()].map(([herbId, item]) => ({
        herbId,
        herbName: item.name,
        fromDoseRaw: item.doseRaw,
      })),
      doseChanged: [],
    }
  }

  const removed: FormulaHerbDelta[] = []
  const added: FormulaHerbDelta[] = []
  const doseChanged: FormulaHerbDelta[] = []

  for (const [herbId, item] of mapA) {
    const other = mapB.get(herbId)
    if (!other) {
      removed.push({ herbId, herbName: item.name, fromDoseRaw: item.doseRaw })
    } else if (other.doseRaw !== item.doseRaw) {
      doseChanged.push({
        herbId,
        herbName: item.name,
        fromDoseRaw: item.doseRaw,
        toDoseRaw: other.doseRaw,
      })
    }
  }
  for (const [herbId, item] of mapB) {
    if (!mapA.has(herbId)) {
      added.push({ herbId, herbName: item.name, toDoseRaw: item.doseRaw })
    }
  }

  if (removed.length === 0 && added.length === 0 && doseChanged.length === 0) {
    return {
      fromId: from.id,
      toId: to.id,
      kind: 'multi',
      label: '同方',
      added: [],
      removed: [],
      doseChanged: [],
    }
  }

  if (removed.length === 1 && added.length === 0 && doseChanged.length === 0) {
    return {
      fromId: from.id,
      toId: to.id,
      kind: 'remove',
      label: `去·${removed[0]!.herbName}`,
      added,
      removed,
      doseChanged,
    }
  }
  if (added.length === 1 && removed.length === 0 && doseChanged.length === 0) {
    return {
      fromId: from.id,
      toId: to.id,
      kind: 'add',
      label: `加·${added[0]!.herbName}`,
      added,
      removed,
      doseChanged,
    }
  }
  if (doseChanged.length === 1 && added.length === 0 && removed.length === 0) {
    const item = doseChanged[0]!
    return {
      fromId: from.id,
      toId: to.id,
      kind: 'dose',
      label: `改·${item.herbName}`,
      added,
      removed,
      doseChanged,
    }
  }

  const parts: string[] = []
  if (added.length) parts.push(`加${joinNames(added)}`)
  if (removed.length) parts.push(`去${joinNames(removed)}`)
  if (doseChanged.length) parts.push(`改${joinNames(doseChanged)}`)
  return {
    fromId: from.id,
    toId: to.id,
    kind: 'multi',
    label: `多·${parts.join('')}`,
    added,
    removed,
    doseChanged,
  }
}

/** 家族图：祖方 → 各方；同名异本互连 */
export function buildFamilyRelations(
  members: Formula[],
  baseFormulaId: string,
): FormulaRelation[] {
  if (members.length === 0) return []
  const root = resolveFamilyRoot(members, baseFormulaId)
  if (!root) return []

  const relations: FormulaRelation[] = []
  const seen = new Set<string>()
  const push = (relation: FormulaRelation | null) => {
    if (!relation) return
    const key = `${relation.fromId}>${relation.toId}`
    if (seen.has(key)) return
    seen.add(key)
    relations.push(relation)
  }

  for (const member of members) {
    if (member.id === root.id) continue
    push(compareFormulas(root, member))
  }

  // 同名异本：非根的宋本/金匮/桂林互连（若尚未被根边覆盖同名对）
  const byName = new Map<string, Formula[]>()
  for (const member of members) {
    const list = byName.get(member.name) ?? []
    list.push(member)
    byName.set(member.name, list)
  }
  for (const list of byName.values()) {
    if (list.length < 2) continue
    const ordered = [...list].sort((a, b) => a.book.localeCompare(b.book))
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const left = ordered[i]!
        const right = ordered[j]!
        // 根已连到双方时，仍补同名异本边便于对照
        if (left.id === root.id || right.id === root.id) continue
        push(compareFormulas(left, right))
      }
    }
  }

  return relations
}

export function resolveFamilyRoot(members: Formula[], baseFormulaId: string): Formula | undefined {
  const byId = new Map(members.map((item) => [item.id, item]))
  const named = byId.get(baseFormulaId)
  const baseName =
    named && !/[加去]/.test(named.name)
      ? named.name
      : (members.find((item) => !/[加去]/.test(item.name))?.name ?? named?.name)
  return (
    members.find((item) => item.book === 'songben' && item.name === baseName) ??
    members.find((item) => item.name === baseName) ??
    named ??
    members.find((item) => item.book === 'songben') ??
    members[0]
  )
}
