import { describe, expect, it } from 'vitest'
import {
  JOBKOKO_LICENSE,
  TextDecodingError,
  jobkokoEvidence,
  jobkokoSectionAt,
  normalizeUtf8Text,
  parseCsvRows,
  parseJobkokoCatalog,
  parseJobkokoFileName,
  parseJobkokoText,
} from './jobkoko.ts'

const SHENNONG_SAMPLE = [
  '<篇名>神农本草经',
  '书名：神农本草经',
  '作者：孙星衍  ',
  '朝代：清  ',
  '年份：公元1644-1911年  ',
  '',
  '',
  '',
  '<目录>',
  '',
  '<篇名>邵序',
  '',
  '内容：《记》曰∶医不三世，不服其药。',
  '郑康成曰∶慎物齐也。',
  '',
  '<目录>卷一',
  '',
  '<篇名>上经',
  '',
  '内容：上药一百二十种',
  '',
  '<目录>卷一\\上经',
  '',
  '<篇名>丹沙',
  '',
  '内容：味甘微寒。  ',
  '主身体五脏百病。《说文》云∶KT ，KT 。',
  '',
  '<目录>卷一\\上经',
  '',
  '<篇名>空篇',
  '',
  '<目录>卷二',
  '<篇名>中经',
  '属性：中药一百二十种',
].join('\n')

describe('parseJobkokoText', () => {
  const parsed = parseJobkokoText(SHENNONG_SAMPLE, { fileName: 'data/vendor/jobkoko/tcm/B-001-神农本草经.txt' })

  it('解析书级元数据与文件名类别/序号', () => {
    expect(parsed.fileName).toBe('B-001-神农本草经.txt')
    expect(parsed.meta).toEqual({
      bookTitle: '神农本草经',
      author: '孙星衍',
      dynasty: '清',
      year: '公元1644-1911年',
      category: 'B',
      serial: 1,
      code: 'B-001',
    })
  })

  it('按篇名切分章节，目录路径决定层级，去掉内容/属性标签', () => {
    expect(
      parsed.sections.map(({ title, level, path, text, label, implicit }) => ({ title, level, path, text, label, implicit })),
    ).toEqual([
      { title: '邵序', level: 1, path: [], text: '《记》曰∶医不三世，不服其药。\n郑康成曰∶慎物齐也。', label: '内容', implicit: false },
      { title: '上经', level: 2, path: ['卷一'], text: '上药一百二十种', label: '内容', implicit: false },
      {
        title: '丹沙',
        level: 3,
        path: ['卷一', '上经'],
        text: '味甘微寒。\n主身体五脏百病。《说文》云∶KT ，KT 。',
        label: '内容',
        implicit: false,
      },
      { title: '空篇', level: 3, path: ['卷一', '上经'], text: '', label: null, implicit: false },
      { title: '中经', level: 2, path: ['卷二'], text: '中药一百二十种', label: '属性', implicit: false },
    ])
  })

  it('startOffset / textOffset 指向 fullText 中的标题与正文', () => {
    for (const section of parsed.sections) {
      expect(parsed.fullText.slice(section.startOffset, section.startOffset + section.title.length)).toBe(section.title)
      expect(parsed.fullText.slice(section.textOffset, section.textOffset + section.text.length)).toBe(section.text)
    }
    expect(parsed.fullText.startsWith('邵序\n《记》曰')).toBe(true)
    expect(parsed.missingCharPlaceholders).toBe(2)
  })

  it('jobkokoSectionAt 按 offset 找章节', () => {
    expect(jobkokoSectionAt(parsed, parsed.fullText.indexOf('主身体'))?.title).toBe('丹沙')
    expect(jobkokoSectionAt(parsed, 0)?.title).toBe('邵序')
    expect(jobkokoSectionAt(parsed, parsed.fullText.length)?.title).toBe('中经')
    expect(jobkokoSectionAt(parsed, -1)).toBeNull()
    expect(jobkokoSectionAt(parsed, parsed.fullText.length + 1)).toBeNull()
  })

  it('无目录/篇名的书：正文归入以书名为题的隐式章节', () => {
    const text = '<篇名>鬼门十三针\n书名：鬼门十三针\n作者：孙思邈(传)\n朝代：唐\n年份：公元652年\n\n\n孙真人针十三鬼穴歌\n\n　　百邪颠狂所为病，\n'
    const result = parseJobkokoText(text, { fileName: 'Z-003-鬼门十三针.txt' })
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]).toMatchObject({
      title: '鬼门十三针',
      level: 1,
      implicit: true,
      startOffset: 0,
      textOffset: 0,
      text: '孙真人针十三鬼穴歌\n\n　　百邪颠狂所为病，',
    })
    expect(result.fullText).toBe(result.sections[0].text)
  })

  it('处理 BOM 与 CRLF；缺书名时回退到篇名或文件名', () => {
    const text = '\uFEFF<篇名>某书\r\n作者：佚名\r\n<目录>\r\n<篇名>卷首\r\n内容：甲\r\n乙\r\n'
    const result = parseJobkokoText(text, { fileName: 'X-999-某书.txt' })
    expect(result.meta.bookTitle).toBe('某书')
    expect(result.meta.dynasty).toBeNull()
    expect(result.sections[0].text).toBe('甲\n乙')
    expect(result.fullText).not.toContain('\r')

    const untitled = parseJobkokoText('正文', { fileName: 'notes.txt' })
    expect(untitled.meta).toMatchObject({ bookTitle: 'notes.txt', category: null, serial: null, code: null })
  })

  it('疑似 GBK 乱码时抛出带文件名的错误', () => {
    const garbled = `<篇名>${'\uFFFD'.repeat(20)}\n书名：${'\uFFFD'.repeat(20)}\n`
    expect(() => parseJobkokoText(garbled, { fileName: 'B-001-神农本草经.txt' })).toThrow(TextDecodingError)
    expect(() => parseJobkokoText(garbled, { fileName: 'B-001-神农本草经.txt' })).toThrow(/B-001-神农本草经\.txt/)
    expect(() => normalizeUtf8Text('锟斤拷锟斤拷', 'a.txt')).toThrow(/锟斤拷/)
  })

  it('零星 U+FFFD 不视为整体乱码', () => {
    const text = `${'正文'.repeat(500)}\uFFFD${'正文'.repeat(500)}`
    expect(() => normalizeUtf8Text(text, 'a.txt')).not.toThrow()
  })
})

describe('parseJobkokoFileName', () => {
  it('解析 {类别}-{序号}-{书名}.txt，兼容 Windows 路径', () => {
    expect(parseJobkokoFileName('D:\\vendor\\jobkoko\\tcm\\A-010-塘医话&馤塘医话.txt')).toEqual({
      category: 'A',
      serial: 10,
      code: 'A-010',
      title: '塘医话&馤塘医话',
    })
    expect(parseJobkokoFileName('古籍目录.csv')).toBeNull()
  })
})

describe('parseJobkokoCatalog', () => {
  it('处理 BOM、CRLF、引号内逗号与转义引号、空行、误入的标签单元格', () => {
    const csv = [
      '\uFEFF编号,书名,作者,朝代,年份',
      'A-001,石山医案,汪机,明,公元1519年',
      'A-010,"塘医话,馤塘医话","佚""名""",清,"公元1644-1911年"',
      '',
      'Z-036,黄帝明堂灸经,不详,唐代,<目录>',
    ].join('\r\n')
    expect(parseJobkokoCatalog(`${csv}\r\n`)).toEqual([
      { code: 'A-001', title: '石山医案', author: '汪机', dynasty: '明', year: '公元1519年' },
      { code: 'A-010', title: '塘医话,馤塘医话', author: '佚"名"', dynasty: '清', year: '公元1644-1911年' },
      { code: 'Z-036', title: '黄帝明堂灸经', author: '不详', dynasty: '唐代', year: '' },
    ])
  })

  it('按表头名取列，允许列顺序变化与缺列', () => {
    expect(parseJobkokoCatalog('书名,编号\nX,B-002\n')).toEqual([
      { code: 'B-002', title: 'X', author: '', dynasty: '', year: '' },
    ])
  })

  it('表头缺编号/书名或引号未闭合时抛错', () => {
    expect(() => parseJobkokoCatalog('a,b\n1,2\n')).toThrow(/编号/)
    expect(() => parseJobkokoCatalog('编号,书名\nA-001,"未闭合\n')).toThrow(/引号/)
  })

  it('parseCsvRows 支持引号内换行与单独 CR 换行', () => {
    expect(parseCsvRows('a,"b\nc"\rd,e')).toEqual([
      ['a', 'b\nc'],
      ['d', 'e'],
    ])
    expect(parseCsvRows('')).toEqual([])
  })
})

describe('jobkokoEvidence', () => {
  const commit = '89abcdef0123456789abcdef0123456789abcdef'

  it('构造 sourceId / locator / group / license', () => {
    expect(jobkokoEvidence('data\\vendor\\jobkoko\\tcm\\B-001-神农本草经.txt', commit, '丹沙', '味甘微寒')).toEqual({
      sourceId: 'jobkoko@89abcde',
      group: 'web-simplified',
      locator: 'B-001-神农本草经.txt#丹沙',
      quote: '味甘微寒',
      license: JOBKOKO_LICENSE,
    })
    const withoutSection = jobkokoEvidence('B-001-神农本草经.txt', commit)
    expect(withoutSection.locator).toBe('B-001-神农本草经.txt')
    expect(withoutSection).not.toHaveProperty('quote')
  })

  it('参数非法时抛错', () => {
    expect(() => jobkokoEvidence('B-001-神农本草经.txt', 'not-a-sha')).toThrow(/commit/)
    expect(() => jobkokoEvidence('', commit)).toThrow(/文件名/)
    expect(() => jobkokoEvidence('A#B.txt', commit)).toThrow(/#/)
  })
})
