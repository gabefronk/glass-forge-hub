import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';
import Invoicing from '@/pages/Invoicing';
import CalendarPage from '@/pages/CalendarPage';
import JobsHub from '@/pages/JobsHub';
import JobDetail from '@/pages/JobDetail';
import WindowQuotes from '@/pages/WindowQuotes';
import Dashboard from '@/pages/Dashboard';
import MatchDebug from '@/pages/MatchDebug';
import { Navigate } from 'react-router-dom';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import OAuthConsent from '@/pages/OAuthConsent';
import SalesTracker from '@/pages/SalesTracker';
import AdminAgentCenter from "@/pages/AdminAgentCenter";
import BrandsSpecs from "@/pages/BrandsSpecs";
import ProbuildDailyPreview from "@/pages/ProbuildDailyPreview";
import MessagesInbox from "@/pages/MessagesInbox";
import ContactsDirectory from "@/pages/ContactsDirectory";
import ReportLibraryRedirect from '@/components/ReportLibraryRedirect';
import ReportsRedirect from '@/components/ReportsRedirect';
import SystemMap from "@/pages/SystemMap";
import ResearchQueue from "@/pages/ResearchQueue";
import Todos from '@/pages/Todos';
import JobBudgets from '@/pages/JobBudgets';
import PurchaseOrders from '@/pages/PurchaseOrders';
import Summit from '@/pages/Summit';
import UnlinkedJobRecords from '@/pages/UnlinkedJobRecords';
import JobSetup from '@/pages/JobSetup';
import InboxAgents from '@/pages/InboxAgents';
import { isWindowQuotesOnly } from '@/lib/agentCenterAccess';
// Add page imports here

const QuotesOnlyRedirect = ({ children }) => {
  const { user } = useAuth();
  if (isWindowQuotesOnly(user)) return <Navigate to="/window-quotes" replace />;
  return children;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/oauth/consent" element={<OAuthConsent />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<Layout />}>
          <Route path="/" element={<QuotesOnlyRedirect><Invoicing /></QuotesOnlyRedirect>} />
          <Route path="/calendar" element={<QuotesOnlyRedirect><CalendarPage /></QuotesOnlyRedirect>} />
          <Route path="/dashboard" element={<QuotesOnlyRedirect><Dashboard /></QuotesOnlyRedirect>} />
          <Route path="/todos" element={<QuotesOnlyRedirect><Todos /></QuotesOnlyRedirect>} />
          <Route path="/inbox-agents" element={<QuotesOnlyRedirect><InboxAgents /></QuotesOnlyRedirect>} />
          <Route path="/window-quotes" element={<WindowQuotes />} />
          <Route path="/sales-tracker" element={<QuotesOnlyRedirect><SalesTracker /></QuotesOnlyRedirect>} />
          <Route path="/admin/agents" element={<QuotesOnlyRedirect><AdminAgentCenter /></QuotesOnlyRedirect>} />
          <Route path="/system-map" element={<QuotesOnlyRedirect><SystemMap /></QuotesOnlyRedirect>} />
          <Route path="/admin/probuild-daily" element={<QuotesOnlyRedirect><ProbuildDailyPreview /></QuotesOnlyRedirect>} />
          <Route path="/messages" element={<QuotesOnlyRedirect><MessagesInbox /></QuotesOnlyRedirect>} />
          <Route path="/contacts" element={<QuotesOnlyRedirect><ContactsDirectory /></QuotesOnlyRedirect>} />
          <Route path="/reports" element={<QuotesOnlyRedirect><ReportsRedirect /></QuotesOnlyRedirect>} />
          <Route path="/report-library" element={<QuotesOnlyRedirect><ReportLibraryRedirect /></QuotesOnlyRedirect>} />
          <Route path="/jobs" element={<QuotesOnlyRedirect><JobsHub /></QuotesOnlyRedirect>} />
          <Route path="/jobs/:id" element={<QuotesOnlyRedirect><JobDetail /></QuotesOnlyRedirect>} />
          <Route path="/jobs/:id/setup" element={<QuotesOnlyRedirect><JobSetup /></QuotesOnlyRedirect>} />
          <Route path="/match-debug" element={<QuotesOnlyRedirect><MatchDebug /></QuotesOnlyRedirect>} />
          <Route path="/brands-specs" element={<BrandsSpecs />} />
          <Route path="/products" element={<Navigate to="/brands-specs" replace />} />
          <Route path="/research-queue" element={<QuotesOnlyRedirect><ResearchQueue /></QuotesOnlyRedirect>} />
          <Route path="/job-budgets" element={<QuotesOnlyRedirect><JobBudgets /></QuotesOnlyRedirect>} />
          <Route path="/purchase-orders" element={<QuotesOnlyRedirect><PurchaseOrders /></QuotesOnlyRedirect>} />
          <Route path="/admin/unlinked" element={<QuotesOnlyRedirect><UnlinkedJobRecords /></QuotesOnlyRedirect>} />
          <Route path="/summit" element={<Summit />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
