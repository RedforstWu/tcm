import { faLayerGroup } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { isKangpingLayer, type KangpingLayer } from '@/lib/integration'

const LAYER_CLASS: Record<KangpingLayer, string> = {
  原文: 'bg-teal-soft text-teal',
  追文: 'bg-violet-50 text-violet-700',
  注文: 'bg-stone-100 text-stone-500',
}

/** 康平本分层小标签；层次缺失或非法时不渲染 */
export function KangpingTag({ layer }: { layer?: unknown }) {
  if (!isKangpingLayer(layer)) return null
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${LAYER_CLASS[layer]}`} title={`康平本分层：${layer}`}>
      <FontAwesomeIcon icon={faLayerGroup} className="text-[9px]" />
      康平·{layer}
    </span>
  )
}
