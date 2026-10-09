import { faArrowUpRightFromSquare, faQuoteLeft, faScaleBalanced } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { Evidence } from '@/types/data'
import {
  EVIDENCE_FIELD_LABEL,
  EVIDENCE_VERDICT_META,
  KANRIPO_LICENSE,
  KANRIPO_LICENSE_URL,
  evidenceHref,
  evidenceLevelMeta,
  formatEvidenceRatio,
  readVariantSegments,
  sourceGroupLabel,
  toEvidence,
  type VariantSegment,
} from '@/lib/integration'
import { convertScript, type ScriptMode } from '@/lib/text'
import { VariantSegments } from './VariantSegments'

export interface EvidencePanelProps {
  evidence?: Evidence[] | null
  level?: string | null
  scriptMode?: ScriptMode
  className?: string
}

interface EvidenceRow {
  evidence: Evidence
  variants: VariantSegment[]
}

function toRows(raw: unknown): EvidenceRow[] {
  if (!Array.isArray(raw)) return []
  const rows: EvidenceRow[] = []
  for (const item of raw) {
    const evidence = toEvidence(item)
    if (evidence) rows.push({ evidence, variants: readVariantSegments(item) })
  }
  return rows
}

export function KanripoLicenseNote({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-start gap-1 text-[10px] leading-relaxed text-stone-400 ${className}`}>
      <FontAwesomeIcon icon={faScaleBalanced} className="mt-0.5" />
      <span>
        漢籍リポジトリ（Kanripo）文本依{' '}
        <a href={KANRIPO_LICENSE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-teal">
          {KANRIPO_LICENSE}
        </a>{' '}
        授权，转载须署名并以相同方式共享。
      </span>
    </p>
  )
}

export function EvidenceSourceLine({ evidence }: { evidence: Evidence }) {
  const href = evidenceHref(evidence)
  const verdictMeta = evidence.verdict ? EVIDENCE_VERDICT_META[evidence.verdict] : null
  const ratioText = formatEvidenceRatio(evidence.ratio)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-stone-500">
      <span className="rounded bg-paper-dark px-1.5 py-0.5 font-medium text-stone-700">
        {sourceGroupLabel(evidence.group)}
      </span>
      {(evidence.field || verdictMeta) && (
        <span className="inline-flex items-center gap-1">
          {evidence.field && <span className="text-stone-600">{EVIDENCE_FIELD_LABEL[evidence.field]}</span>}
          {verdictMeta && <span className={`font-medium ${verdictMeta.textClass}`}>{verdictMeta.label}</span>}
          {ratioText && <span className="text-stone-400">相似度 {ratioText}</span>}
        </span>
      )}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all font-mono text-teal hover:underline"
          title="在 GitHub 打开见证本原卷"
        >
          {evidence.locator}
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="ml-1 text-[9px]" />
        </a>
      ) : (
        <span className="break-all font-mono">{evidence.locator}</span>
      )}
      <span className="text-stone-400">许可：{evidence.license}</span>
    </div>
  )
}

/** 证据列表：来源组、locator（Kanripo 可外链）、许可、引文与异文 */
export function EvidencePanel({ evidence, level, scriptMode = 'simplified', className = '' }: EvidencePanelProps) {
  const meta = evidenceLevelMeta(level)
  const rows = toRows(evidence)
  if (!meta && rows.length === 0) return null
  const hasKanripo = rows.some((row) => row.evidence.group === 'kanripo')
  return (
    <div className={`space-y-2 rounded-xl border border-stone-200 bg-white/90 p-3 text-xs ${className}`}>
      {meta && (
        <p className="text-stone-500">
          <span className="font-medium text-stone-700">{meta.label}</span>：{meta.description}
        </p>
      )}
      {rows.length === 0 && <p className="text-stone-400">构建端未附带证据明细。</p>}
      <ul className="space-y-2">
        {rows.map(({ evidence: item, variants }, index) => (
          <li key={`${item.sourceId}-${item.locator}-${index}`} className="space-y-1 border-t border-stone-100 pt-2 first:border-0 first:pt-0">
            <EvidenceSourceLine evidence={item} />
            {variants.length > 0 ? (
              <VariantSegments segments={variants} witnessLabel={sourceGroupLabel(item.group)} />
            ) : (
              item.quote && (
                <blockquote className="prose-classic flex gap-1.5 rounded-lg bg-paper-dark/60 px-2 py-1.5 text-sm text-stone-700">
                  <FontAwesomeIcon icon={faQuoteLeft} className="mt-1 text-[9px] text-stone-400" />
                  <span>{convertScript(item.quote, scriptMode)}</span>
                </blockquote>
              )
            )}
          </li>
        ))}
      </ul>
      {hasKanripo && <KanripoLicenseNote />}
    </div>
  )
}
