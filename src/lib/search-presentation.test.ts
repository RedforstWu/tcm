import { describe, expect, it } from 'vitest'
import { applySearchQuery, orderSearchResults, presentSearchResult, searchQueryFromParams } from './search-presentation'

describe('search presentation', () => {
  it('读写 q，并把出处编码显示成中文', () => {
    expect(searchQueryFromParams(new URLSearchParams('q=桂枝汤'))).toBe('桂枝汤')
    const written = applySearchQuery(new URLSearchParams('mode=x'), '桂枝汤')
    expect(written.get('q')).toBe('桂枝汤')
    expect(written.get('mode')).toBe('x')
    expect(applySearchQuery(written, '  ').has('q')).toBe(false)

    expect(
      presentSearchResult({ type: 'clause', book: 'songben', title: 'songben·辨太阳病脉证并治下·155' }),
    ).toEqual({
      typeLabel: '条文',
      bookLabel: '宋本伤寒论',
      title: '宋本伤寒论 · 辨太阳病脉证并治下',
    })
    expect(
      presentSearchResult({ type: 'clause', book: 'danxi', title: 'danxi·痞三十四·3' }),
    ).toEqual({
      typeLabel: '条文',
      bookLabel: '丹溪心法',
      title: '丹溪心法 · 痞',
    })
    expect(
      orderSearchResults([
        { book: 'danxi', score: 20 },
        { book: 'songben', score: 5 },
        { book: 'jingui', score: 4 },
      ]).map((item) => item.book),
    ).toEqual(['songben', 'jingui', 'danxi'])
  })
})
