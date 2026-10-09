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
  faCircleNodes,
  faLanguage,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAppContext } from '@/context/AppContext'

const NAV = [
  { to: '/', label: '首页', icon: faHouse, end: true },
  { to: '/read/songben', label: '条文', icon: faBookOpen },
  { to: '/formulas', label: '方剂', icon: faPills },
  { to: '/herbs', label: '药物', icon: faFlask },
  { to: '/graph', label: '图谱', icon: faCircleNodes },
  { to: '/viz', label: '可视化', icon: faChartPie },
  { to: '/lab', label: '实验室', icon: faFlask },
  { to: '/reasoning', label: '辨证推理', icon: faCodeBranch },
  { to: '/quiz', label: '测验', icon: faGraduationCap },
  { to: '/search', label: '搜索', icon: faSearch },
]

export function Layout() {
  const { scriptMode, setScriptMode } = useAppContext()
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
          <button
            type="button"
            aria-label={scriptMode === 'simplified' ? '切换为繁体' : '切换为简体'}
            className="ml-auto shrink-0 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-50 sm:px-3 sm:py-2"
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
        文本来源：维基文库公有领域古籍 · 校勘见证：漢籍リポジトリ Kanripo（CC BY-SA 4.0） ·
        证候/方解标签含规则与大模型草稿（待校对） ·
        陈士铎著作含托名成分
      </footer>
    </div>
  )
}
