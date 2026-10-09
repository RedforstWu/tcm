import type { VariantSegment } from '@/lib/integration'

export interface VariantSegmentsProps {
  segments: VariantSegment[]
  /** 见证本名称，用于图例 */
  witnessLabel?: string
}

/** 异文对照：本站文本与见证本逐段差异 */
export function VariantSegments({ segments, witnessLabel = '见证本' }: VariantSegmentsProps) {
  if (segments.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="prose-classic text-sm leading-relaxed text-stone-700">
        {segments.map((segment, index) => {
          switch (segment.op) {
            case 'equal':
              return <span key={index}>{segment.local}</span>
            case 'delete':
              return (
                <del key={index} className="rounded bg-rose-50 px-0.5 text-rose-700" title={`${witnessLabel}无此字`}>
                  {segment.local}
                </del>
              )
            case 'insert':
              return (
                <ins key={index} className="rounded bg-emerald-50 px-0.5 text-emerald-700 no-underline" title={`${witnessLabel}多出`}>
                  {segment.witness}
                </ins>
              )
            case 'replace':
              return (
                <span key={index} className="rounded bg-amber-50 px-0.5" title={`本站「${segment.local}」，${witnessLabel}作「${segment.witness}」`}>
                  <del className="text-rose-700">{segment.local}</del>
                  <ins className="text-emerald-700 no-underline">{segment.witness}</ins>
                </span>
              )
            default:
              return null
          }
        })}
      </p>
      <p className="text-[10px] text-stone-400">
        <span className="text-rose-700 line-through">红删</span> 为本站有而{witnessLabel}无；
        <span className="text-emerald-700">绿字</span> 为{witnessLabel}所作
      </p>
    </div>
  )
}
