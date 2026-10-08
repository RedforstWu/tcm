import { useDeferredValue, useMemo, useState } from 'react'
import { faFilter, faMagnifyingGlass, faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { ChenfuChain } from '@/components/reasoning/ChenfuChain'
import {
  CHENFU_BOOK_LABELS,
  DISPUTE_FILTER_LABELS,
  caseTitle,
  disputeKindsOfCase,
  flattenRecords,
  type BrowserItem,
  type DisputeFilter,
} from '@/lib/chenfu'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'
import type { ChenfuReasoningBook, ChenfuReasoningDataset, ChenfuRecord } from '@/types/data'

interface ChenfuCaseBrowserProps {
  dataset: ChenfuReasoningDataset
  selectedKey: string | null
  onSelect: (key: string) => void
}

const PAGE_SIZE = 150
const TAG_OPTION_LIMIT = 40
const BOOK_ORDER: ChenfuReasoningBook[] = ['bianzheng', 'funvke', 'funanke', 'shishi']
const DISPUTE_FILTERS: DisputeFilter[] = [
  'misdiagnosis',
  'mistreatment',
  'drugDoubt',
  'commonPractice',
  'none',
]

function topTags(records: ChenfuRecord[], pick: (record: ChenfuRecord) => string[]): string[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    for (const tag of pick(record)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, TAG_OPTION_LIMIT)
    .map(([tag]) => tag)
}

function itemSearchText(item: BrowserItem): string {
  const { record, caseItem } = item
  return [
    record.chapter,
    record.heading ?? '',
    caseItem?.symptomText ?? '',
    caseItem?.pathogenesis ?? '',
    caseItem?.treatmentPrinciple ?? '',
  ].join('\n')
}

export function ChenfuCaseBrowser({ dataset, selectedKey, onSelect }: ChenfuCaseBrowserProps) {
  const { scriptMode } = useAppContext()
  const [book, setBook] = useState<ChenfuReasoningBook | 'all'>('all')
  const [symptomTag, setSymptomTag] = useState('')
  const [pathogenesisTag, setPathogenesisTag] = useState('')
  const [disputeFilters, setDisputeFilters] = useState<Set<DisputeFilter>>(new Set())
  const [onlyAnnotated, setOnlyAnnotated] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const deferredKeyword = useDeferredValue(keyword.trim())

  const allItems = useMemo(() => flattenRecords(dataset.records), [dataset.records])
  const bookRecords = useMemo(
    () => (book === 'all' ? dataset.records : dataset.records.filter((record) => record.book === book)),
    [dataset.records, book],
  )
  const symptomOptions = useMemo(() => topTags(bookRecords, (record) => record.symptomTags), [bookRecords])
  const pathogenesisOptions = useMemo(
    () => topTags(bookRecords, (record) => record.pathogenesisTags),
    [bookRecords],
  )

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (book !== 'all' && item.record.book !== book) return false
      if (onlyAnnotated && !item.caseItem) return false
      if (symptomTag && !item.record.symptomTags.includes(symptomTag)) return false
      if (pathogenesisTag && !item.record.pathogenesisTags.includes(pathogenesisTag)) return false
      if (disputeFilters.size > 0) {
        if (!item.caseItem) return false
        const kinds = disputeKindsOfCase(item.caseItem)
        if (![...disputeFilters].some((filter) => kinds.has(filter))) return false
      }
      if (deferredKeyword && !itemSearchText(item).includes(deferredKeyword)) return false
      return true
    })
  }, [allItems, book, onlyAnnotated, symptomTag, pathogenesisTag, disputeFilters, deferredKeyword])

  const selectedItem = useMemo(
    () => allItems.find((item) => item.key === selectedKey) ?? filteredItems[0] ?? null,
    [allItems, filteredItems, selectedKey],
  )

  const resetPaging = () => setVisibleCount(PAGE_SIZE)

  const toggleDispute = (filter: DisputeFilter) => {
    setDisputeFilters((current) => {
      const next = new Set(current)
      if (next.has(filter)) next.delete(filter)
      else next.add(filter)
      return next
    })
    resetPaging()
  }

  const resetFilters = () => {
    setBook('all')
    setSymptomTag('')
    setPathogenesisTag('')
    setDisputeFilters(new Set())
    setOnlyAnnotated(false)
    setKeyword('')
    resetPaging()
  }

  const visibleItems = filteredItems.slice(0, visibleCount)
  const groupOf = (item: BrowserItem) => `${CHENFU_BOOK_LABELS[item.record.book]} · ${item.record.chapter}`

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <aside className="min-w-0 space-y-3">
        <div className="space-y-2 rounded-2xl border border-stone-200 bg-white/80 p-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-stone-700">
              <FontAwesomeIcon icon={faFilter} className="text-cinnabar" />
              筛选病案
            </h2>
            <button type="button" onClick={resetFilters} className="text-xs text-stone-500 hover:text-cinnabar">
              <FontAwesomeIcon icon={faRotateLeft} className="mr-1" />
              重置
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {(['all', ...BOOK_ORDER] as const).map((bookId) => (
              <button
                key={bookId}
                type="button"
                onClick={() => {
                  setBook(bookId)
                  setSymptomTag('')
                  setPathogenesisTag('')
                  resetPaging()
                }}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  book === bookId ? 'bg-cinnabar text-white' : 'bg-stone-100 text-stone-600 hover:bg-cinnabar-soft'
                }`}
              >
                {bookId === 'all' ? '全部' : CHENFU_BOOK_LABELS[bookId]}
              </button>
            ))}
          </div>

          <label className="relative block">
            <FontAwesomeIcon
              icon={faMagnifyingGlass}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-stone-400"
            />
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                resetPaging()
              }}
              placeholder="症状、病机、门类关键词"
              className="w-full rounded-lg border border-stone-200 bg-white py-1.5 pl-7 pr-2 text-sm outline-none focus:border-cinnabar"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={symptomTag}
              onChange={(event) => {
                setSymptomTag(event.target.value)
                resetPaging()
              }}
              className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs"
              aria-label="症状标签"
            >
              <option value="">症状标签</option>
              {symptomOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {convertScript(tag, scriptMode)}
                </option>
              ))}
            </select>
            <select
              value={pathogenesisTag}
              onChange={(event) => {
                setPathogenesisTag(event.target.value)
                resetPaging()
              }}
              className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs"
              aria-label="病机标签"
            >
              <option value="">病机标签</option>
              {pathogenesisOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {convertScript(tag, scriptMode)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-1">
            {DISPUTE_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => toggleDispute(filter)}
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  disputeFilters.has(filter)
                    ? 'bg-teal text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-teal-soft'
                }`}
              >
                {DISPUTE_FILTER_LABELS[filter]}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={onlyAnnotated}
              onChange={(event) => {
                setOnlyAnnotated(event.target.checked)
                resetPaging()
              }}
            />
            只看已标注
          </label>
          <p className="text-[11px] text-stone-400">共 {filteredItems.length} 项</p>
        </div>

        <ul className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
          {visibleItems.map((item, index) => {
            const group = groupOf(item)
            const showGroup = index === 0 || group !== groupOf(visibleItems[index - 1])
            const active = item.key === selectedItem?.key
            return (
              <li key={item.key}>
                {showGroup && (
                  <p className="sticky top-0 z-10 bg-paper/95 px-1 pb-1 pt-2 text-[11px] font-semibold text-stone-400">
                    {convertScript(group, scriptMode)}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onSelect(item.key)}
                  className={`w-full rounded-lg px-2.5 py-2 text-left text-xs transition ${
                    active ? 'bg-cinnabar text-white' : 'bg-white text-stone-700 ring-1 ring-stone-100 hover:bg-cinnabar-soft'
                  }`}
                >
                  <span className="block">
                    {item.caseItem
                      ? convertScript(caseTitle(item.caseItem, item.record), scriptMode)
                      : convertScript(item.record.heading ?? item.record.clauseId, scriptMode)}
                  </span>
                  <span className={`mt-0.5 block text-[10px] ${active ? 'text-white/70' : 'text-stone-400'}`}>
                    {item.caseItem
                      ? item.caseItem.disputes.length > 0
                        ? `辩难 ${item.caseItem.disputes.length} 处`
                        : '直述证治'
                      : '待标注'}
                    {item.caseItem?.methodCategory ? ` · ${item.caseItem.methodCategory}` : ''}
                  </span>
                </button>
              </li>
            )
          })}
          {filteredItems.length > visibleCount && (
            <li>
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                className="w-full rounded-lg bg-stone-100 py-2 text-xs text-stone-600 hover:bg-stone-200"
              >
                显示更多（剩余 {filteredItems.length - visibleCount}）
              </button>
            </li>
          )}
          {filteredItems.length === 0 && (
            <li className="rounded-lg bg-white px-3 py-4 text-center text-xs text-stone-400">没有符合条件的病案</li>
          )}
        </ul>
      </aside>

      <div className="min-w-0 rounded-2xl border border-stone-200 bg-white/90 p-3 shadow-sm sm:p-4">
        {selectedItem ? (
          <ChenfuChain
            key={selectedItem.key}
            record={selectedItem.record}
            caseItem={selectedItem.caseItem}
            formulas={dataset.formulas}
          />
        ) : (
          <p className="text-sm text-stone-500">请在左侧选择病案。</p>
        )}
      </div>
    </div>
  )
}
