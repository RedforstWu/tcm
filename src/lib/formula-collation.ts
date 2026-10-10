const COLLATION_NOTES: Record<string, string> = {
  'songben-formula-桂枝加葛根汤':
    '汗出恶风而方中有麻黄。林亿等认为与无汗用麻黄之例不合，怀疑只是桂枝汤加葛根。组成仍按宋本保留麻黄。出处：宋本《伤寒论》林亿等校注，第 14 条方后。',
}

export function collationNoteForFormula(formulaId: string, _herbs?: readonly string[]): string | null {
  return COLLATION_NOTES[formulaId] ?? null
}
