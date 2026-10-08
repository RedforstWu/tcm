import {
  faBookOpen,
  faFlask,
  faHouse,
  faPills,
  faChartPie,
  faSearch,
  faGraduationCap,
  faLanguage,
  faLayerGroup,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { NavLink, Outlet } from 'react-router-dom'
import { useAppContext, type CorpusFilter } from '@/context/AppContext'

const NAV = [
  { to: '/', label: '首页', icon: faHouse, end: true },
  { to: '/read/songben', label: '条文', icon: faBookOpen },
  { to: '/formulas', label: '方剂', icon: faPills },
  { to: '/herbs', label: '药物', icon: faFlask },
  { to: '/viz', label: '可视化', icon: faChartPie },
  { to: '/lab', label: '实验室', icon: faFlask },
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

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-[#fffdf8]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 font-serif text-lg font-bold text-cinnabar">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cinnabar text-sm text-white">
              仲
            </span>
            伤寒金匮·陈傅学习站
          </NavLink>
          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm transition ${
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
          <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-0.5 text-xs">
            <FontAwesomeIcon icon={faLayerGroup} className="ml-2 text-stone-400" />
            {CORPUS_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCorpusFilter(option.id)}
                className={`rounded-md px-2 py-1.5 ${
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
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
            onClick={() =>
              setScriptMode(scriptMode === 'simplified' ? 'traditional' : 'simplified')
            }
          >
            <FontAwesomeIcon icon={faLanguage} className="mr-1.5" />
            {scriptMode === 'simplified' ? '繁体' : '简体'}
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
                  isActive ? 'bg-cinnabar text-white' : 'bg-stone-100 text-stone-600'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-stone-200/80 py-6 text-center text-xs text-stone-500">
        文本来源：维基文库公有领域古籍 · 证候/方解标签含规则与大模型草稿（待校对） ·
        陈士铎著作含托名成分
      </footer>
    </div>
  )
}
