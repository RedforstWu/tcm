/** 「此六味地黄汤方」「宜大承气汤」「与小柴胡汤」「宜常服当归散」中方名前的指示词/用药引语 */
const MENTION_LEAD_RE =
  /^(?:此|宜常服|宜|可与|当与|当以|与|仿|仲景|东垣|曰|渇|应宜|属宜|辛凉平剂|辛凉轻剂|辛凉重剂|治以|投以|调以|凉如|宜凉|吴又可)/
const MIN_MENTION_NAME_LENGTH = 2

/** 「不可与白虎汤」等否定用药，不应挂 citesFormula */
export function isNegatedFormulaMention(text: string, formulaIndex: number): boolean {
  const before = text.slice(Math.max(0, formulaIndex - 6), formulaIndex)
  return /不可与|不得与|勿与|不可更行|不可更|禁与|慎勿用|勿用|不可用|不宜用|不可服/.test(before)
}

/**
 * 条文中「X主之」「X方」提及的方名。
 * 原文名已是本书既有方名（如辨证录「宜春汤」）则保留，否则剥去引语。
 */
export function resolveMentionedFormulaName(
  rawMention: string,
  book: string,
  existingKeys: Set<string>,
): string {
  const base = rawMention.replace(/(?:主之|方)$/, '')
  if (existingKeys.has(`${book}:${base}`)) return base
  let stripped = base.replace(MENTION_LEAD_RE, '')
  // 可叠剥：曰仿凉膈散 → 凉膈散
  stripped = stripped.replace(MENTION_LEAD_RE, '')
  return stripped.length >= MIN_MENTION_NAME_LENGTH ? stripped : base
}
