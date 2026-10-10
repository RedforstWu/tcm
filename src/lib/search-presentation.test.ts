import { describe, expect, it } from 'vitest'
import { applySearchQuery, presentSearchResult, searchQueryFromParams } from './search-presentation'

describe('search presentation', () => {
  it('读写 q，并把出处编码显示成中文', () => {
    expect(searchQueryFromParams(new URLSearchParams('q=桂枝汤'))).toBe('桂枝汤')
    const written = applySearchQuery(new URLSearchParams('mode=x'), '桂枝汤')
    expect(written.get('q')).toBe('桂枝汤')
    expect(written.get('mode')).toBe('x')
    expect(applySearchQuery(written, '  ').has('q')).toBe(false)

    expect(
      presentSearchResult({ type: 'clause', book: 'songben', title: 'songben·太阳·12' }),
    ).toEqual({
      typeLabel: '条文',
      bookLabel: '宋本',
      title: '宋本·太阳·12',
    })
    expect(
      presentSearchResult({ type: 'clause', book: 'danxi', title: 'danxi·痞三十四·3' }),
    ).toMatchObject({
      typeLabel: '条文',
      bookLabel: '丹溪',
      title: '丹溪·痞三十四·3',
    })
  })
})
