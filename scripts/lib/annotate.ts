import type { Clause } from '../../src/types/data.ts'

const SYMPTOM_LEXICON: string[] = [
  '恶寒', '恶风', '发热', '汗出', '无汗', '头痛', '项强', '项背强', '身痛', '体痛',
  '骨节疼痛', '腰痛', '咳', '喘', '干呕', '呕', '吐', '下利', '下痢', '便秘', '不大便',
  '腹痛', '腹满', '心下痞', '心下满', '胸满', '胁痛', '胁下痞硬', '烦躁', '烦', '渴',
  '大渴', '小便不利', '小便自利', '厥', '手足厥冷', '谵语', '不能食', '喜呕', '咽干',
  '咽痛', '耳聋', '目眩', '心悸', '悸', '短气', '身黄', '发黄', '衄', '下血', '吐血',
  '失眠', '不得眠', '盗汗', '自汗', '潮热', '日晡潮热', '郑声', '发狂', '如狂',
  '项背强几几', '肉瞤', '筋惕肉瞤', '身重', '嗜卧', '多眠睡', '口苦', '咽干', '目眩',
]

const PULSE_LEXICON: string[] = [
  '脉浮', '脉沉', '脉迟', '脉数', '脉紧', '脉缓', '脉弦', '脉涩', '脉微', '脉弱',
  '脉洪大', '脉浮紧', '脉浮缓', '脉浮数', '脉沉迟', '脉沉紧', '脉阴阳俱紧', '脉微细',
]

const PATHOGENESIS_LEXICON: string[] = [
  '表未解', '表证', '里证', '热入血室', '蓄血', '结胸', '脏结', '痞', '水气', '痰饮',
  '胃家实', '亡阳', '亡津液', '热结', '寒结', '虚劳', '风湿', '风温', '温病',
]

export function annotateClause(clause: Clause): Clause {
  const text = clause.text
  const symptomTags = SYMPTOM_LEXICON.filter((item) => text.includes(item))
  const pulseTags = PULSE_LEXICON.filter((item) => text.includes(item))
  const pathogenesisTags = PATHOGENESIS_LEXICON.filter((item) => text.includes(item))

  // 去重包含关系：同时有恶寒与恶风都保留；有「脉浮紧」时也保留「脉浮」「脉紧」可接受
  return {
    ...clause,
    symptomTags: [...new Set(symptomTags)],
    pulseTags: [...new Set(pulseTags)],
    pathogenesisTags: [...new Set(pathogenesisTags)],
    reviewStatus: 'ai-draft',
  }
}

export function annotateClauses(clauses: Clause[]): Clause[] {
  return clauses.map(annotateClause)
}
