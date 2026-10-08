import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider } from '@/context/AppContext'
import { Layout } from '@/components/Layout'
import { HomePage } from '@/pages/HomePage'
import { ReaderPage } from '@/pages/ReaderPage'
import { FormulasPage } from '@/pages/FormulasPage'
import { FormulaDetailPage } from '@/pages/FormulaDetailPage'
import { FamilyGraphPage } from '@/pages/FamilyGraphPage'
import { HerbsPage } from '@/pages/HerbsPage'
import { HerbDetailPage } from '@/pages/HerbDetailPage'
import { VizPage } from '@/pages/VizPage'
import { LabPage } from '@/pages/LabPage'
import { QuizPage } from '@/pages/QuizPage'
import { ReasoningPage } from '@/pages/ReasoningPage'
import { SearchPage } from '@/pages/SearchPage'

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="read/:book" element={<ReaderPage />} />
            <Route path="formulas" element={<FormulasPage />} />
            <Route path="formulas/family" element={<FamilyGraphPage />} />
            <Route path="formulas/:formulaId" element={<FormulaDetailPage />} />
            <Route path="herbs" element={<HerbsPage />} />
            <Route path="herbs/:herbId" element={<HerbDetailPage />} />
            <Route path="viz" element={<VizPage />} />
            <Route path="lab" element={<LabPage />} />
            <Route path="reasoning" element={<ReasoningPage />} />
            <Route path="quiz" element={<QuizPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
