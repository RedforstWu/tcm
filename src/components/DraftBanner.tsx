import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

export function DraftBanner() {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-soft px-4 py-3 text-sm text-amber-900">
      <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" />
      <div className="space-y-1">
        <p>
          证候标签、方解中的药物作用含规则抽取与大模型（Grok）草稿（ai-draft），请对照原文阅读，勿直接作临床依据。
        </p>
        <p className="text-xs text-amber-800/80">
          陈士铎《辨证录》《石室秘录》《本草新编》等书含托名成分；《傅青主女科》与《辨证录》妇科条文大量重合，阅读时注意对照标记。
        </p>
      </div>
    </div>
  )
}
