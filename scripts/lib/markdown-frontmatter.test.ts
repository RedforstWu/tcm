import { describe, expect, it } from 'vitest'
import {
  extractBacktickSpans,
  extractBlockquoteLines,
  extractListItems,
  extractWikilinks,
  findSectionByPrefix,
  getSection,
  normalizeNewlines,
  parseMarkdownWithFrontmatter,
  parseWikilink,
  splitFrontmatter,
  splitSections,
  stripWikilinks,
  wikilinkBasename,
} from './markdown-frontmatter.ts'

describe('splitFrontmatter', () => {
  it('拆分 CRLF + BOM 的 frontmatter 与正文', () => {
    const text = '\uFEFF---\r\ntype: 条文\r\n条文号: 12\r\n---\r\n\r\n# 条文 012\r\n'
    const result = splitFrontmatter(text)
    expect(result.frontmatterText).toBe('type: 条文\n条文号: 12')
    expect(result.body).toBe('\n# 条文 012\n')
  })

  it('无起始分隔行或未闭合时视为无 frontmatter', () => {
    expect(splitFrontmatter('# 方剂清单\n- 桂枝汤').frontmatterText).toBeNull()
    expect(splitFrontmatter('---\ntype: 条文\n正文没有闭合').frontmatterText).toBeNull()
  })

  it('正文里的 --- 分隔线不影响拆分', () => {
    const result = splitFrontmatter('---\na: 1\n---\n上文\n---\n下文')
    expect(result.frontmatterText).toBe('a: 1')
    expect(result.body).toBe('上文\n---\n下文')
  })
})

describe('parseMarkdownWithFrontmatter', () => {
  it('解析 YAML 标量、流式数组与布尔值', () => {
    const parsed = parseMarkdownWithFrontmatter(
      '---\n条文号: 12\n关联方剂: ["[[桂枝汤]]"]\n性味: [辛, 甘, 温]\n版本争议: false\n---\n正文',
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data).toEqual({
      条文号: 12,
      关联方剂: ['[[桂枝汤]]'],
      性味: ['辛', '甘', '温'],
      版本争议: false,
    })
    expect(parsed.body).toBe('正文')
  })

  it('无 frontmatter 返回 no-frontmatter', () => {
    const parsed = parseMarkdownWithFrontmatter('# 药材清单\n')
    expect(parsed).toMatchObject({ ok: false, reason: 'no-frontmatter' })
  })

  it('YAML 语法错误返回 yaml-error 而不抛异常', () => {
    const parsed = parseMarkdownWithFrontmatter('---\na: [1, 2\nb: : :\n---\n')
    expect(parsed).toMatchObject({ ok: false, reason: 'yaml-error' })
  })

  it('重复键视为 YAML 错误', () => {
    const parsed = parseMarkdownWithFrontmatter('---\na: 1\na: 2\n---\n')
    expect(parsed).toMatchObject({ ok: false, reason: 'yaml-error' })
  })

  it('标量 frontmatter 返回 not-mapping，空 frontmatter 得到空对象', () => {
    expect(parseMarkdownWithFrontmatter('---\n只是字符串\n---\n')).toMatchObject({
      ok: false,
      reason: 'not-mapping',
    })
    expect(parseMarkdownWithFrontmatter('---\n---\n正文')).toEqual({ ok: true, data: {}, body: '正文' })
  })
})

describe('splitSections', () => {
  const body = [
    '# 桂枝汤',
    '',
    '## 原文',
    '> 太阳中风……桂枝汤主之。',
    '',
    '### 小标题不切分',
    '内容',
    '## 煎服法',
    '```',
    '## 围栏内不切分',
    '```',
    '以水七升',
    '',
  ].join('\n')

  it('按二级标题切分并去除首尾空行', () => {
    const sections = splitSections(body)
    expect(sections.map((section) => section.heading)).toEqual(['原文', '煎服法'])
    expect(getSection(sections, '原文')).toBe('> 太阳中风……桂枝汤主之。\n\n### 小标题不切分\n内容')
    expect(getSection(sections, '煎服法')).toBe('```\n## 围栏内不切分\n```\n以水七升')
  })

  it('按前缀查找段落，找不到返回 null', () => {
    const sections = splitSections('## 原文（宋版）\n> 甲\n')
    expect(findSectionByPrefix(sections, '原文')).toBe('> 甲')
    expect(getSection(sections, '原文')).toBeNull()
  })
})

describe('wikilink 清洗', () => {
  it('[[a]] 取目标名，[[path|别名]] 取别名', () => {
    expect(stripWikilinks('原文载方：[[桂枝汤]]。')).toBe('原文载方：桂枝汤。')
    expect(stripWikilinks('[[01_条文/太阳病/条文-012|条文-012]] 太阳中风')).toBe('条文-012 太阳中风')
    expect(stripWikilinks('| [[陈皮\\|橘皮]] | 二两 |')).toBe('| 橘皮 | 二两 |')
  })

  it('空别名退回目标名', () => {
    expect(stripWikilinks('[[桂枝|]]')).toBe('桂枝')
  })

  it('parseWikilink 只接受整串单个链接', () => {
    expect(parseWikilink(' [[侧柏叶|柏叶]] ')).toEqual({ target: '侧柏叶', display: '柏叶' })
    expect(parseWikilink('蜂蜜（食材/辅料，不建药物卡）')).toBeNull()
    expect(parseWikilink('[[a]][[b]]')).toBeNull()
  })

  it('extractWikilinks 与 wikilinkBasename', () => {
    const links = extractWikilinks('- [[01_条文/厥阴病/条文-351|条文-351]]、[[乌梅丸]]')
    expect(links).toEqual([
      { target: '01_条文/厥阴病/条文-351', display: '条文-351' },
      { target: '乌梅丸', display: '乌梅丸' },
    ])
    expect(wikilinkBasename(links[0].target)).toBe('条文-351')
    expect(wikilinkBasename('乌梅丸')).toBe('乌梅丸')
  })
})

describe('引用块 / 反引号 / 列表提取', () => {
  it('提取引用块行，保留原标点', () => {
    const content = '> 太阳之为病，脉浮，头项强痛而恶寒。\n>\n> 第二段\n非引用'
    expect(extractBlockquoteLines(content)).toEqual(['太阳之为病，脉浮，头项强痛而恶寒。', '', '第二段'])
  })

  it('提取反引号内原句', () => {
    const text = '- 《伤寒贯珠集》云：`太陽中風者。陽受風氣而未及乎陰也。`\n- 又云：`是宜桂枝湯助正以逐邪。` 与 `  `'
    expect(extractBacktickSpans(text)).toEqual(['太陽中風者。陽受風氣而未及乎陰也。', '是宜桂枝湯助正以逐邪。'])
  })

  it('列表项去掉标记，非列表行保留', () => {
    expect(extractListItems('- 甲\n* 乙\n1. 丙\n\n丁')).toEqual(['甲', '乙', '丙', '丁'])
  })

  it('normalizeNewlines 处理孤立 CR', () => {
    expect(normalizeNewlines('a\rb\r\nc')).toBe('a\nb\nc')
  })
})
