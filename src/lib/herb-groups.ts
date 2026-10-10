const ALIAS_GROUPS: Array<{ id: string; members: string[] }> = [
  { id: '芍药', members: ['芍药', '白芍'] },
  { id: '黄芪', members: ['黄芪', '黄茋'] },
  { id: '熟地黄', members: ['熟地黄', '熟地'] },
]

export interface HerbFilterOption {
  id: string
  label: string
  memberIds: string[]
}

export function herbFilterOptions(herbs: Array<{ id: string; name: string }>): HerbFilterOption[] {
  const present = new Set(herbs.map((herb) => herb.id))
  const consumed = new Set<string>()
  const options: HerbFilterOption[] = []

  for (const herb of herbs) {
    if (consumed.has(herb.id)) continue
    const group = ALIAS_GROUPS.find((item) => item.members.includes(herb.id))
    if (!group) {
      consumed.add(herb.id)
      options.push({ id: herb.id, label: herb.name, memberIds: [herb.id] })
      continue
    }
    const memberIds = group.members.filter((id) => present.has(id))
    for (const id of memberIds) consumed.add(id)
    const aliases = memberIds.filter((id) => id !== group.id)
    options.push({
      id: group.id,
      label: aliases.length > 0 ? `${group.id}（${aliases.join('、')}）` : group.id,
      memberIds,
    })
  }

  return options
}

export function herbFilterMatches(formulaHerbIds: string[], filterId: string): boolean {
  const group = ALIAS_GROUPS.find((item) => item.id === filterId)
  if (group) return formulaHerbIds.some((id) => group.members.includes(id))
  return formulaHerbIds.includes(filterId)
}
