import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AuthProvider } from '@/contexts/AuthContext'
import { HouseholdProvider } from '@/contexts/HouseholdContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { AbonnementsPage } from '@/pages/AbonnementsPage'
import { AnalysePage } from '@/pages/AnalysePage'
import { CategoriesPage } from '@/pages/CategoriesPage'
import { DettePage } from '@/pages/DettePage'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { EpargnePage } from '@/pages/EpargnePage'
import { ExpensesPage } from '@/pages/ExpensesPage'
import { HomePage } from '@/pages/HomePage'
import { HouseholdPage } from '@/pages/HouseholdPage'
import { IAFinancePage } from '@/pages/IAFinancePage'
import { IncomesPage } from '@/pages/IncomesPage'
import { MorePage } from '@/pages/MorePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { HouseholdSetupPage } from '@/pages/onboarding/HouseholdSetupPage'
import { PatrimoinePage } from '@/pages/PatrimoinePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { PublicOnly, RequireAuth, RequireHousehold } from '@/routes/guards'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <HouseholdProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <Routes>
              <Route element={<PublicOnly />}>
                <Route path="/connexion" element={<LoginPage />} />
                <Route path="/inscription" element={<RegisterPage />} />
                <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
              </Route>

              <Route element={<RequireAuth />}>
                <Route path="/bienvenue" element={<HouseholdSetupPage />} />
                <Route path="/rejoindre" element={<HouseholdSetupPage />} />

                <Route element={<RequireHousehold />}>
                  <Route element={<AppShell />}>
                    <Route index element={<HomePage />} />
                    <Route path="depenses" element={<ExpensesPage />} />
                    <Route path="revenus" element={<IncomesPage />} />
                    <Route path="categories" element={<CategoriesPage />} />
                    <Route path="epargne" element={<EpargnePage />} />
                    <Route path="dette" element={<DettePage />} />
                    <Route path="analyse" element={<AnalysePage />} />
                    <Route path="patrimoine" element={<PatrimoinePage />} />
                    <Route path="objectifs" element={<Navigate to="/epargne" replace />} />
                    <Route path="abonnements" element={<AbonnementsPage />} />
                    <Route path="documents" element={<DocumentsPage />} />
                    <Route path="ia" element={<IAFinancePage />} />
                    <Route path="foyer" element={<HouseholdPage />} />
                    <Route path="parametres" element={<SettingsPage />} />
                    <Route path="plus" element={<MorePage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </HouseholdProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
