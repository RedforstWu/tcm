import type { HerbRole, ReviewStatus } from '../../src/types/data.ts'
import { canonicalizeChenfuHerb } from './herb-lexicon.ts'
import { toSimplifiedChinese } from './wiki.ts'

export interface FangjieExtractInput {
  formulaId: string
  fangjie: string
  herbIds: string[]
  herbNames: string[]
}

/**
 * 规则抽取方解中的药物作用句。
 * 支持：用X以Y / 益之以X之Y / 加X以Y / X以Y之 / X、Y以Z
 */
export function extractHerbRolesFromFangjie(input: FangjieExtractInput): HerbRole[] {
  const text = toSimplifiedChinese(input.fangjie)
  if (!text.trim()) return []

  const nameToId = new Map<string, string>()
  for (let i = 0; i < input.herbNames.length; i += 1) {
    const name = input.herbNames[i]!
    const id = input.herbIds[i]!
    nameToId.set(name, id)
    // 短名别称：熟地黄 → 也认「熟地」若方中只有熟地黄
    if (name.length >= 3) {
      nameToId.set(name.slice(0, 2), id)
    }
  }

  const roles: HerbRole[] = []
  const pushRole = (
    rawName: string,
    roleText: string,
    sentence: string,
    mechanism?: string,
  ) => {
    const canon = canonicalizeChenfuHerb(rawName) || rawName
    const herbId = nameToId.get(canon) ?? nameToId.get(rawName)
    if (!herbId) return
    if (!roleText.trim()) return
    const id = `${input.formulaId}__${herbId}__rule__${roles.length}`
    const reviewStatus: ReviewStatus = 'ai-draft'
    roles.push({
      id,
      formulaId: input.formulaId,
      herbId,
      roleText: roleText.trim().replace(/[。；;]+$/, ''),
      mechanism,
      sourceSentence: sentence.trim(),
      method: 'rule',
      reviewStatus,
    })
  }

  // 按句号/分号切句
  const sentences = text.split(/[。；;]/g).map((s) => s.trim()).filter(Boolean)

  for (const sentence of sentences) {
    // 益之以茵陈之利湿，栀子之清热
    const yiZhiYi = [
      ...sentence.matchAll(
        /益之以([\u4e00-\u9fff]{1,6})之([\u4e00-\u9fff]{1,12})/g,
      ),
    ]
    if (yiZhiYi.length > 0) {
      for (const match of yiZhiYi) {
        pushRole(match[1]!, match[2]!, sentence)
      }
      // 同句后续「栀子之清热」
      const more = [...sentence.matchAll(/[、，,]([\u4e00-\u9fff]{1,6})之([\u4e00-\u9fff]{1,12})/g)]
      for (const match of more) {
        pushRole(match[1]!, match[2]!, sentence)
      }
      continue
    }

    // 用石膏、知母以泻其阳明之火邪
    const yongDuo = sentence.match(
      /用([\u4e00-\u9fff、，,]{2,40}?)以([\u4e00-\u9fff之的]{2,30})/,
    )
    if (yongDuo) {
      const names = yongDuo[1]!.split(/[、，,]/g).map((n) => n.trim()).filter(Boolean)
      const roleText = yongDuo[2]!
      for (const name of names) {
        pushRole(name, roleText, sentence)
      }
      continue
    }

    // 用柴胡以… / 加茵陈以…
    const yongSingle = [
      ...sentence.matchAll(
        /(?:用|加|佐|藉|借)([\u4e00-\u9fff]{1,6})以([\u4e00-\u9fff之的]{2,30})/g,
      ),
    ]
    if (yongSingle.length > 0) {
      for (const match of yongSingle) {
        pushRole(match[1]!, match[2]!, sentence)
      }
      continue
    }

    // 石膏以泻火 / 白术以健脾
    const yiZhi = [
      ...sentence.matchAll(
        /([\u4e00-\u9fff]{1,6})以([\u4e00-\u9fff]{2,16})/g,
      ),
    ]
    for (const match of yiZhi) {
      const name = match[1]!
      // 过滤非药主语
      if (/^(所以|是以|可以|何以|未以|不以|方以|此以|故以|能以)/.test(name)) continue
      if (name.length > 4) continue
      pushRole(name, match[2]!, sentence)
    }
  }

  // 去重：同 formula+herb+roleText
  const seen = new Set<string>()
  return roles.filter((role) => {
    const key = `${role.herbId}|${role.roleText}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
