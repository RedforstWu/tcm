import { useState } from 'react'
import { Link } from 'react-router-dom'
import { faChevronDown, faFeatherPointed } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { hasKanripoEvidence, type Commentary } from '@/lib/integration'
import { convertScript, type ScriptMode } from '@/lib/text'
import { EvidenceSourceLine, KanripoLicenseNote } from './EvidencePanel'

export interface CommentaryListProps {
  /** 该条文的注文（已只含核验通过的原句）；空或缺失时不渲染 */
  commentaries?: Commentary[]
  scriptMode?: ScriptMode
  /** 方剂 id → 方名，用于注文涉及方剂的链接 */
  formulaNameById?: ReadonlyMap<string, string>
  defaultExpanded?: boolean
}

/** 条文下的「注家」区：可展开，显示核验通过的原句及出处 */
export function CommentaryList({
  commentaries,
  scriptMode = 'simplified',
  formulaNameById,
  defaultExpanded = false,
}: CommentaryListProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  if (!commentaries || commentaries.length === 0) return null
  const names = [...new Set(commentaries.map((item) => item.commentator))]
  const showLicense = commentaries.some(
    (item) =>
      hasKanripoEvidence(item.evidence) ||
      item.quotes.some((quote) => quote.evidence?.group === 'kanripo'),
  )

  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-paper/60">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-stone-600 hover:text-cinnabar"
      >
        <FontAwesomeIcon icon={faFeatherPointed} className="text-cinnabar" />
        <span className="font-medium">注家</span>
        <span className="text-stone-400">{names.join(' · ')}</span>
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`ml-auto text-[10px] transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-stone-200 px-3 py-3">
          {commentaries.map((item) => (
            <section key={item.id} className="space-y-1.5">
              <p className="text-xs">
                <span className="font-medium text-ink">{item.commentator}</span>
                {item.sourceBook && <span className="ml-1 text-stone-400">《{item.sourceBook}》</span>}
              </p>
              <ul className="space-y-2">
                {item.quotes.map((quote, index) => {
                  const source = quote.evidence ?? item.evidence[0]
                  return (
                    <li key={`${item.id}-${index}`} className="space-y-1">
                      <blockquote className="prose-classic border-l-2 border-cinnabar/40 pl-2 text-sm text-stone-700">
                        {convertScript(quote.text, scriptMode)}
                      </blockquote>
                      {source && <EvidenceSourceLine evidence={source} />}
                    </li>
                  )
                })}
              </ul>
              {item.formulaIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.formulaIds.map((formulaId) => (
                    <Link
                      key={formulaId}
                      to={`/formulas/${encodeURIComponent(formulaId)}`}
                      className="rounded-full bg-cinnabar-soft px-2 py-0.5 text-[11px] text-cinnabar"
                    >
                      {convertScript(
                        formulaNameById?.get(formulaId) ?? formulaId.replace(/^[\w-]+-formula-/, ''),
                        scriptMode,
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ))}
          <p className="text-[10px] text-stone-400">仅显示已在注家原书见证本中逐字核验的原句。</p>
          {showLicense && <KanripoLicenseNote />}
        </div>
      )}
    </div>
  )
}
