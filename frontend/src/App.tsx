import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./Layout";
import Dashboard from "./pages/Dashboard";
import FarmerList from "./pages/FarmerList";
import DataEntryWizard from "./pages/DataEntryWizard";
import MasterData from "./pages/MasterData";
import SurveyView from "./pages/SurveyView";
import FarmerHistory from "./pages/FarmerHistory";
import PlotBoundaryCapture from "./pages/PlotBoundaryCapture";
import PlotsRegistry from "./pages/PlotsRegistry";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import UserManagement from "./pages/UserManagement";
import EntryLanding from "./pages/EntryLanding";
import FPOConsultationWizard from "./pages/FPOConsultationWizard";
import FPOConsultationsList from "./pages/FPOConsultationsList";
import { LangProvider } from "./LangContext";
import { AuthProvider } from "./AuthContext";
import ProtectedRoute from "./ProtectedRoute";

export default function App() {
  return (
    <AuthProvider>
      <LangProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                <Route element={<ProtectedRoute requireAny={["survey_entry", "fpo_consultation"]} />}>
                  <Route path="/entry" element={<EntryLanding />} />
                </Route>
                <Route element={<ProtectedRoute require="survey_entry" />}>
                  <Route path="/entry/farmer" element={<DataEntryWizard />} />
                </Route>
                <Route element={<ProtectedRoute require="fpo_consultation" />}>
                  <Route path="/entry/fpo" element={<FPOConsultationWizard />} />
                  <Route path="/fpo-consultations" element={<FPOConsultationsList />} />
                </Route>
                <Route element={<ProtectedRoute require="farmer_records" />}>
                  <Route path="/farmers" element={<FarmerList />} />
                  <Route path="/farmers/:id" element={<SurveyView />} />
                  <Route path="/farmers/:id/history" element={<FarmerHistory />} />
                </Route>
                <Route element={<ProtectedRoute require="plots_map" />}>
                  <Route path="/farmers/:id/plot-boundary" element={<PlotBoundaryCapture />} />
                  <Route path="/plots" element={<PlotsRegistry />} />
                </Route>
                <Route element={<ProtectedRoute require="admin" />}>
                  <Route path="/masters" element={<MasterData />} />
                  <Route path="/users" element={<UserManagement />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </LangProvider>
    </AuthProvider>
  );
}
