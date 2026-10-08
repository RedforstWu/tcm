import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { BookId, Clause, Formula, HerbMonograph, HerbRole } from '@/types/data'
import { BOOK_CORPUS } from '@/types/data'
import {
  bookTitle,
  loadAlignments,
  loadClauses,
  loadFormulas,
  loadHerbRoles,
  loadMonographs,
} from '@/lib/data'
import { convertScript, highlightTerms } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'
import { DraftBanner } from '@/components/DraftBanner'

const JINGFANG_BOOKS: BookId[] = ['songben', 'jingui', 'guilin']
const CHENFU_BOOKS: BookId[] = ['funvke', 'funanke', 'bianzheng', 'shishi']

export function ReaderPage() {
  const { book = 'songben' } = useParams()
  const allBooks = [...JINGFANG_BOOKS, ...CHENFU_BOOKS]
  const bookId = (allBooks.includes(book as BookId) ? book : 'songben') as BookId
  const [searchParams, setSearchParams] = useSearchParams()
  const { scriptMode, corpusFilter } = useAppContext()
  const [clauses, setClauses] = useState<Clause[]>([])
  const [guilinMap, setGuilinMap] = useState<Map<string, Clause>>(new Map())
  const [parallelMap, setParallelMap] = useState<Map<string, Clause>>(new Map())
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [roles, setRoles] = useState<HerbRole[]>([])
  const [monographs, setMonographs] = useState<HerbMonograph[]>([])
  const [compare, setCompare] = useState(bookId === 'songben')
  const [chapter, setChapter] = useState<string>('全部')
  const [hoverHerb, setHoverHerb] = useState<{
    herbId: string
    formulaId: string
    x: number
    y: number
  } | null>(null)

  const visibleBooks = useMemo(() => {
    if (corpusFilter === 'jingfang') return JINGFANG_BOOKS
    if (corpusFilter === 'chenfu') return CHENFU_BOOKS
    return allBooks
  }, [corpusFilter])

  useEffect(() => {
    void loadClauses(bookId).then((items) => {
      setClauses(items)
      const chapters = [...new Set(items.map((item) => item.chapter))]
      setChapter('全部')
      void chapters
    })
  }, [bookId])

  useEffect(() => {
    void Promise.all([loadFormulas(), loadHerbRoles(), loadMonographs()]).then(
      ([formulaList, roleList, monoList]) => {
        setFormulas(formulaList)
        setRoles(roleList)
        setMonographs(monoList)
      },
    )
  }, [])

  useEffect(() => {
    if (bookId !== 'songben') return
    void Promise.all([loadClauses('guilin'), loadAlignments()]).then(([guilin]) => {
      setGuilinMap(new Map(guilin.map((item) => [item.id, item])))
    })
  }, [bookId])

  useEffect(() => {
    if (BOOK_CORPUS[bookId] !== 'chenfu') return
    const parallelBooks: BookId[] =
      bookId === 'funvke'
        ? ['bianzheng']
        : bookId === 'funanke'
          ? ['bianzheng', 'shishi']
          : bookId === 'bianzheng'
            ? ['funvke', 'funanke']
            : ['funanke']
    void Promise.all(parallelBooks.map((id) => loadClauses(id))).then((lists) => {
      const map = new Map<string, Clause>()
      for (const list of lists) {
        for (const clause of list) map.set(clause.id, clause)
      }
      setParallelMap(map)
    })
  }, [bookId])

  const chapters = useMemo(
    () => ['全部', ...new Set(clauses.map((item) => item.chapter))],
    [clauses],
  )

  const visible = useMemo(() => {
    if (chapter === '全部') return clauses
    return clauses.filter((item) => item.chapter === chapter)
  }, [clauses, chapter])

  const focusId = searchParams.get('clause')
  const formulaNameById = useMemo(
    () => new Map(formulas.map((f) => [f.id, f.name])),
    [formulas],
  )

  useEffect(() => {
    if (!focusId) return
    const el = document.getElementById(focusId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusId, visible])

  const hoverMono = hoverHerb
    ? monographs.find((m) => m.herbId === hoverHerb.herbId)
    : undefined
  const hoverRoles = hoverHerb
    ? roles.filter((r) => r.herbId === hoverHerb.herbId && r.formulaId === hoverHerb.formulaId)
    : []

  return (
    <div className="space-y-4">
      <DraftBanner />
      <div className="flex flex-wrap items-center gap-2">
        {visibleBooks.map((id) => (
          <Link
            key={id}
            to={`/read/${id}`}
            className={`rounded-full px-4 py-1.5 text-sm ${
              id === bookId ? 'bg-cinnabar text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200'
            }`}
          >
            {bookTitle(id)}
          </Link>
        ))}
        {bookId === 'songben' && (
          <button
            type="button"
            onClick={() => setCompare((value) => !value)}
            className="ml-auto rounded-full bg-teal px-4 py-1.5 text-sm text-white"
          >
            {compare ? '关闭对照' : '宋本 ↔ 桂林对照'}
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {chapters.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setChapter(item)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${
              chapter === item ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200'
            }`}
          >
            {convertScript(item, scriptMode)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {visible.map((clause) => {
          const aligned = clause.alignedGuilinId
            ? guilinMap.get(clause.alignedGuilinId)
            : undefined
          const parallels = (clause.parallelIds ?? [])
            .map((id) => parallelMap.get(id))
            .filter(Boolean) as Clause[]
          const terms = [...clause.symptomTags, ...clause.pulseTags]
          const parts = highlightTerms(convertScript(clause.text, scriptMode), terms)
          const clauseFormulas = clause.formulaIds
            .map((id) => formulas.find((f) => f.id === id))
            .filter(Boolean) as Formula[]

          return (
            <article
              key={clause.id}
              id={clause.id}
              className={`rounded-2xl border bg-white/80 p-4 shadow-sm ${
                focusId === clause.id ? 'border-cinnabar ring-2 ring-cinnabar/20' : 'border-stone-200'
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                <span className="rounded bg-stone-100 px-2 py-0.5">#{clause.order}</span>
                {clause.heading && (
                  <span className="font-medium text-stone-700">
                    {convertScript(clause.heading, scriptMode)}
                  </span>
                )}
                <span>{convertScript(clause.chapter, scriptMode)}</span>
                {clause.channelTags.map((tag) => (
                  <span key={tag} className="rounded bg-teal-soft px-2 py-0.5 text-teal">
                    {tag}
                  </span>
                ))}
                <span className="rounded bg-amber-soft px-2 py-0.5 text-amber-800">
                  {clause.reviewStatus}
                </span>
              </div>

              {clause.misjudgment && (
                <div className="mb-2 rounded-xl bg-amber-soft/50 px-3 py-2 text-xs text-amber-900">
                  <span className="font-medium">人以为</span>
                  {convertScript(clause.misjudgment.commonView, scriptMode)}
                  <span className="mx-1 font-medium">· 谁知</span>
                  {convertScript(clause.misjudgment.trueView, scriptMode)}
                </div>
              )}

              <div className={compare && aligned ? 'grid gap-4 md:grid-cols-2' : ''}>
                <p className="prose-classic text-base text-ink">
                  {parts.map((part, index) =>
                    part.hit ? (
                      <mark key={index} className="rounded bg-amber-200/80 px-0.5">
                        {part.text}
                      </mark>
                    ) : (
                      <span key={index}>{part.text}</span>
                    ),
                  )}
                </p>
                {compare && aligned && (
                  <p className="prose-classic rounded-xl bg-paper-dark p-3 text-sm text-stone-700">
                    <span className="mb-1 block text-xs font-medium text-teal">桂林古本对齐</span>
                    {convertScript(aligned.text, scriptMode)}
                  </p>
                )}
              </div>

              {clauseFormulas.length > 0 && (
                <div className="mt-3 space-y-2">
                  {clauseFormulas.map((formula) => (
                    <div key={formula.id} className="rounded-xl bg-paper-dark/80 px-3 py-2">
                      <Link
                        to={`/formulas/${encodeURIComponent(formula.id)}`}
                        className="text-sm font-medium text-cinnabar"
                      >
                        {convertScript(formula.name, scriptMode)}
                        {formula.role === 'alternate' && (
                          <span className="ml-2 text-xs text-stone-400">备选</span>
                        )}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {formula.herbs.map((herb) => (
                          <button
                            key={`${formula.id}-${herb.herbId}`}
                            type="button"
                            className="rounded-full bg-white px-2 py-0.5 text-xs text-stone-700 ring-1 ring-stone-200 hover:bg-teal-soft"
                            onMouseEnter={(event) =>
                              setHoverHerb({
                                herbId: herb.herbId,
                                formulaId: formula.id,
                                x: event.clientX,
                                y: event.clientY,
                              })
                            }
                            onMouseLeave={() => setHoverHerb(null)}
                          >
                            {convertScript(herb.name, scriptMode)}
                            {herb.doseRaw && (
                              <span className="ml-1 text-stone-400">{herb.doseRaw}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {parallels.length > 0 && (
                <div className="mt-3 rounded-xl border border-teal/30 bg-teal-soft/40 p-3 text-sm">
                  <p className="mb-1 text-xs font-medium text-teal">对照条目</p>
                  {parallels.map((p) => (
                    <Link
                      key={p.id}
                      to={`/read/${p.book}?clause=${p.id}`}
                      className="block text-stone-700 hover:text-cinnabar"
                    >
                      {bookTitle(p.book)} · {convertScript(p.heading ?? p.chapter, scriptMode)}
                    </Link>
                  ))}
                </div>
              )}

              {clause.formulaIds.length > 0 && clauseFormulas.length === 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {clause.formulaIds.map((formulaId) => (
                    <Link
                      key={formulaId}
                      to={`/formulas/${encodeURIComponent(formulaId)}`}
                      className="rounded-full bg-cinnabar-soft px-3 py-1 text-xs text-cinnabar"
                      onClick={() => setSearchParams({ clause: clause.id })}
                    >
                      {convertScript(
                        formulaNameById.get(formulaId) ??
                          formulaId.replace(/^[\w-]+-formula-/, ''),
                        scriptMode,
                      )}
                    </Link>
                  ))}
                </div>
              )}

              {clause.symptomTags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {clause.symptomTags.map((tag) => (
                    <span key={tag} className="rounded bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>

      {hoverHerb && (hoverMono || hoverRoles.length > 0) && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-xl border border-stone-200 bg-white p-3 text-xs shadow-lg"
          style={{ left: hoverHerb.x + 12, top: hoverHerb.y + 12 }}
        >
          {hoverMono && (
            <div className="mb-2">
              <p className="font-medium text-cinnabar">本草新编 · {hoverMono.name}</p>
              <p className="text-stone-500">
                {[hoverMono.flavor && `味${hoverMono.flavor}`, hoverMono.nature && `气${hoverMono.nature}`]
                  .filter(Boolean)
                  .join(' · ')}
                {hoverMono.channels.length > 0 && ` · 入${hoverMono.channels.join('、')}`}
              </p>
              <p className="mt-1 line-clamp-3 text-stone-600">{hoverMono.summary}</p>
            </div>
          )}
          {hoverRoles.length > 0 && (
            <div>
              <p className="font-medium text-teal">本方作用</p>
              {hoverRoles.map((role) => (
                <p key={role.id} className="text-stone-600">
                  {role.roleText}
                  {role.mechanism ? `（${role.mechanism}）` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
