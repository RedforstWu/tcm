/** 已注册解析器键 — 单一来源，供 registry 校验与 dispatch 共用 */
export const REGISTERED_PARSERS = [
  'songben',
  'jingui',
  'guilin',
  'funvke',
  'funanke',
  'bianzheng',
  'shishi',
  'bencao',
  'shennong',
  'xinxiu',
  'zhenglei',
  'wenbing',
  'wenre',
  'piwei',
  'danxi',
  'rumen',
  'xiaoer',
  'jingyue',
  'zhongxi',
  'linzheng',
  'mingyi',
  'xumingyi',
  'yizong',
  'qianjin',
  'waitai',
] as const

export type RegisteredParser = (typeof REGISTERED_PARSERS)[number]

export const REGISTERED_PARSER_SET = new Set<string>(REGISTERED_PARSERS)
