import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBookOpen,
  faChartPie,
  faFlask,
  faPills,
  faGraduationCap,
  faCodeBranch,
} from '@fortawesome/free-solid-svg-icons'
import type { DatasetIndex } from '@/types/data'
import { loadIndex } from '@/lib/data'

const FEATURES = [
  {
    to: '/read/songben',
    title: '条文阅读与对照',
    desc: '经方三本 + 辨证录/石室/女科/男科；女科与辨证录可对照阅读。',
    icon: faBookOpen,
  },
  {
    to: '/formulas',
    title: '方剂库与家族图',
    desc: '组成、煎服法、出处条文；力导向图展示加减关系。',
    icon: faPills,
  },
  {
    to: '/herbs',
    title: '药物对比推导',
    desc: '经方看加减差异；陈傅看法解作用与本草新编药性对照。',
    icon: faFlask,
  },
  {
    to: '/viz',
    title: '全局可视化',
    desc: '药物频次、篇章结构、药-方关系一览。',
    icon: faChartPie,
  },
  {
    to: '/lab',
    title: '组方实验室',
    desc: '勾选药物匹配经方，或加减推演对应原方。',
    icon: faFlask,
  },
  {
    to: '/reasoning',
    title: '辨证开方推理',
    desc: '问诊决策树收敛方证，展开条文→主症→药性→方性推理链。',
    icon: faCodeBranch,
  },
  {
    to: '/quiz',
    title: '互动测验',
    desc: '看条文猜方、看加减猜变化、看组成猜方名。',
    icon: faGraduationCap,
  },
]

export function HomePage() {
  const [index, setIndex] = useState<DatasetIndex | null>(null)

  useEffect(() => {
    void loadIndex().then(setIndex)
  }, [])

  return (
    <div className="space-y-5 sm:space-y-8">
      <section className="rounded-3xl border border-stone-200 bg-white/80 p-5 shadow-sm sm:p-8">
        <p className="mb-2 text-sm font-medium tracking-wide text-teal">经方 · 陈傅 对照学习</p>
        <h1 className="font-serif text-2xl font-bold leading-snug text-ink sm:text-3xl md:text-4xl">
          伤寒金匮 · 陈傅著作 互动学习站
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-stone-600 sm:mt-4 sm:text-base">
          经方以最小差异方剂对观察药证；陈士铎、傅青主著作以方解与《本草新编》贯通药性与方剂。
          顶部可切换「经方 / 陈傅 / 全部」语料。
        </p>
        {index && (
          <div className="mt-5 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3 md:grid-cols-4">
            {[
              ['条文', index.clauseCount],
              ['方剂', index.formulaCount],
              ['药物', index.herbCount],
              ['差异对', index.diffPairCount],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl bg-paper-dark px-3 py-2.5 sm:px-4 sm:py-3">
                <div className="text-xl font-bold text-cinnabar sm:text-2xl">{value}</div>
                <div className="text-sm text-stone-500">{label}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {FEATURES.map((feature) => (
          <Link
            key={feature.to}
            to={feature.to}
            className="group flex items-start gap-3 rounded-2xl border border-stone-200 bg-white/80 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-cinnabar/40 hover:shadow-md active:bg-stone-50 sm:block sm:p-5"
          >
            <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-soft text-teal sm:mb-3">
              <FontAwesomeIcon icon={feature.icon} />
            </div>
            <div className="min-w-0">
              <h2 className="font-serif text-lg font-semibold group-hover:text-cinnabar">
                {feature.title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-stone-600 sm:mt-2">{feature.desc}</p>
            </div>
          </Link>
        ))}
      </section>

      {index && (
        <section className="rounded-2xl border border-stone-200 bg-white/70 p-5 text-sm text-stone-600">
          <h3 className="mb-2 font-serif text-base font-semibold text-ink">数据来源</h3>
          <ul className="space-y-1">
            {index.sources.map((source) => (
              <li key={source.id}>
                <a className="text-teal underline-offset-2 hover:underline" href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
