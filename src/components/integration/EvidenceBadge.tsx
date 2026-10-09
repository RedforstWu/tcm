import {
  faChevronDown,
  faCircleCheck,
  faFileLines,
  faTriangleExclamation,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { EvidenceLevel } from '@/types/data'
import { evidenceLevelMeta } from '@/lib/integration'

const LEVEL_ICON: Record<EvidenceLevel, IconDefinition> = {
  single: faFileLines,
  corroborated: faCircleCheck,
  disputed: faTriangleExclamation,
}

export interface EvidenceBadgeProps {
  level?: string | null
  /** 证据条数，显示在徽标内 */
  count?: number
  /** 受控展开状态；与 onToggle 同时提供时徽标为按钮 */
  expanded?: boolean
  onToggle?: () => void
  className?: string
}

/** 证据等级徽标；等级缺失或未知时不渲染 */
export function EvidenceBadge({ level, count, expanded = false, onToggle, className = '' }: EvidenceBadgeProps) {
  const meta = evidenceLevelMeta(level)
  if (!meta) return null
  const content = (
    <>
      <FontAwesomeIcon icon={LEVEL_ICON[meta.level]} className="text-[10px]" />
      {meta.label}
      {count !== undefined && count > 0 && <span className="opacity-70">·{count}</span>}
    </>
  )
  const baseClass = `inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ring-1 ${meta.badgeClass} ${className}`
  if (!onToggle) {
    return (
      <span className={baseClass} title={meta.description}>
        {content}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      title={`${meta.description}（点击${expanded ? '收起' : '查看'}证据）`}
      className={`${baseClass} hover:brightness-95`}
    >
      {content}
      <FontAwesomeIcon
        icon={faChevronDown}
        className={`text-[9px] transition-transform ${expanded ? 'rotate-180' : ''}`}
      />
    </button>
  )
}
