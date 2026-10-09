import { useState } from 'react'
import type { Evidence } from '@/types/data'
import { evidenceLevelMeta } from '@/lib/integration'
import type { ScriptMode } from '@/lib/text'
import { EvidenceBadge } from './EvidenceBadge'
import { EvidencePanel } from './EvidencePanel'

export interface EvidenceDisclosureProps {
  level?: string | null
  evidence?: Evidence[] | null
  scriptMode?: ScriptMode
  className?: string
}

/** 徽标 + 就地展开的证据面板（非受控）；等级缺失时不渲染 */
export function EvidenceDisclosure({ level, evidence, scriptMode, className = '' }: EvidenceDisclosureProps) {
  const [expanded, setExpanded] = useState(false)
  if (!evidenceLevelMeta(level)) return null
  return (
    <div className={className}>
      <EvidenceBadge
        level={level}
        count={evidence?.length}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded && <EvidencePanel evidence={evidence} level={level} scriptMode={scriptMode} className="mt-2" />}
    </div>
  )
}
