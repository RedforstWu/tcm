/** 基本汉字 + 扩展 A（芎䓖、䗪虫等） */
export const CJK = '\\u3400-\\u4DBF\\u4e00-\\u9fff'
export const CJK_CHAR_RE = new RegExp(`[${CJK}]`, 'g')
export const NON_CJK_RE = new RegExp(`[^${CJK}]`, 'g')

export const DOSE_UNITS =
  '两|升|合|枚|分|斤|铢|株|钱|个|箇|茎|把|尺|片|斗|粒|匕'

export const DOSE_BODY =
  `(?:等分|如鸡子大|如弹丸大|如弹子大|少许|两半|[一二三四五六七八九十百半两\\d.]+(?:${DOSE_UNITS})(?:[一二三四五六七八九十百半两\\d.]+(?:${DOSE_UNITS})?)*)`
