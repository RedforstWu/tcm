import { useEffect, useRef } from 'react'
import {
  faBookOpen,
  faFlask,
  faHouse,
  faPills,
  faChartPie,
  faSearch,
  faGraduationCap,
  faCodeBranch,
  faLanguage,
  faLayerGroup,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAppContext, type CorpusFilter } from '@/context/AppContext'

const NAV = [
  { to: '/', label: '首页', icon: faHouse, end: true },
  { to: '/read/songben', label: '条文', icon: faBookOpen },
  { to: '/formulas', label: '方剂', icon: faPills },
  { to: '/herbs', label: '药物', icon: faFlask },
  { to: '/viz', label: '可视化', icon: faChartPie },
  { to: '/lab', label: '实验室', icon: faFlask },
  { to: '/reasoning', label: '辨证推理', icon: faCodeBranch },
  { to: '/quiz', label: '测验', icon: faGraduationCap },
  { to: '/search', label: '搜索', icon: faSearch },
]

const CORPUS_OPTIONS: Array<{ id: CorpusFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'jingfang', label: '经方' },
  { id: 'chenfu', label: '陈傅' },
]

export function Layout() {
  const { scriptMode, setScriptMode, corpusFilter, setCorpusFilter } = useAppContext()
  const { pathname } = useLocation()
  const mobileNavRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = mobileNavRef.current
    if (!container) return
    const active = container.querySelector<HTMLElement>('[aria-current="page"]')
    if (!active) return
    container.scrollTo({
      left: active.offsetLeft - (container.clientWidth - active.clientWidth) / 2,
      behavior: 'smooth',
    })
  }, [pathname])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-[#fffdf8]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3">
          <NavLink
            to="/"
            className="flex min-w-0 items-center gap-2 font-serif text-base font-bold text-cinnabar sm:text-lg"
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cinnabar text-sm text-white sm:h-9 sm:w-9">
              仲
            </span>
            <span className="truncate">伤寒金匮·陈傅学习站</span>
          </NavLink>
          <nav className="hidden flex-1 items-center gap-1 xl:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition ${
                    isActive
                      ? 'bg-cinnabar-soft font-medium text-cinnabar'
                      : 'text-stone-600 hover:bg-stone-100'
                  }`
                }
              >
                <FontAwesomeIcon icon={item.icon} className="mr-1.5" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-stone-200 bg-white p-0.5 text-xs xl:ml-0">
            <span className="ml-2 hidden text-stone-400 sm:inline">
              <FontAwesomeIcon icon={faLayerGroup} />
            </span>
            {CORPUS_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCorpusFilter(option.id)}
                className={`rounded-md px-1.5 py-1.5 sm:px-2 ${
                  corpusFilter === option.id
                    ? 'bg-teal text-white'
                    : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label={scriptMode === 'simplified' ? '切换为繁体' : '切换为简体'}
            className="shrink-0 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-50 sm:px-3 sm:py-2"
            onClick={() =>
              setScriptMode(scriptMode === 'simplified' ? 'traditional' : 'simplified')
            }
          >
            <FontAwesomeIcon icon={faLanguage} className="sm:mr-1.5" />
            <span className="hidden sm:inline">
              {scriptMode === 'simplified' ? '繁体' : '简体'}
            </span>
            <span className="ml-1 sm:hidden">{scriptMode === 'simplified' ? '繁' : '简'}</span>
          </button>
        </div>
        <div
          ref={mobileNavRef}
          className="scrollbar-none relative flex gap-1.5 overflow-x-auto px-3 pb-2 sm:px-4 xl:hidden"
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
                  isActive ? 'bg-cinnabar text-white' : 'bg-stone-100 text-stone-600'
                }`
              }
            >
              <FontAwesomeIcon icon={item.icon} className="text-[10px]" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
        <Outlet />
      </main>
      <footer className="border-t border-stone-200/80 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-xs leading-relaxed text-stone-500">
        文本来源：维基文库公有领域古籍 · 证候/方解标签含规则与大模型草稿（待校对） ·
        陈士铎著作含托名成分
      </footer>
    </div>
  )
}
