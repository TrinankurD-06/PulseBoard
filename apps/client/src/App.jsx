import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { GuestRoute, ProtectedRoute } from './auth/routes.jsx';
import AppErrorBoundary from './components/AppErrorBoundary.jsx';
import ConfirmProvider from './components/ui/ConfirmProvider.jsx';
import FullPageSpinner from './components/ui/FullPageSpinner.jsx';
import Landing from './pages/Landing.jsx';
import NotFound from './pages/NotFound.jsx';

// Route-level code splitting: the landing page and public status pages don't
// download the dashboard (and its charting library), and vice versa.
const AdminLayout = lazy(() => import('./components/admin/AdminLayout.jsx'));
const AdminOverview = lazy(() => import('./pages/admin/Overview.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/Users.jsx'));
const AdminUserDetail = lazy(() => import('./pages/admin/UserDetail.jsx'));
const AdminWorkspaces = lazy(() => import('./pages/admin/Workspaces.jsx'));
const AdminWorkspaceDetail = lazy(() => import('./pages/admin/WorkspaceDetail.jsx'));
const AdminMonitors = lazy(() => import('./pages/admin/Monitors.jsx'));
const AdminIncidents = lazy(() => import('./pages/admin/Incidents.jsx'));
const AdminIncidentDetail = lazy(() => import('./pages/admin/IncidentDetail.jsx'));
const AdminSystem = lazy(() => import('./pages/admin/System.jsx'));
const AdminAuditLog = lazy(() => import('./pages/admin/AuditLog.jsx'));
const AlertChannels = lazy(() => import('./pages/AlertChannels.jsx'));
const AppIndex = lazy(() => import('./pages/AppIndex.jsx'));
const AppLayout = lazy(() => import('./components/layout/AppLayout.jsx'));
const AuthCallback = lazy(() => import('./pages/auth/AuthCallback.jsx'));
const Bot = lazy(() => import('./pages/Bot.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const EditMonitor = lazy(() => import('./pages/monitors/EditMonitor.jsx'));
const GithubImport = lazy(() => import('./pages/GithubImport.jsx'));
const Incidents = lazy(() => import('./pages/Incidents.jsx'));
const Login = lazy(() => import('./pages/auth/Login.jsx'));
const MonitorDetail = lazy(() => import('./pages/monitors/MonitorDetail.jsx'));
const NewMonitor = lazy(() => import('./pages/monitors/NewMonitor.jsx'));
const PublicStatus = lazy(() => import('./pages/PublicStatus.jsx'));
const Register = lazy(() => import('./pages/auth/Register.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const StatusPages = lazy(() => import('./pages/StatusPages.jsx'));
const Team = lazy(() => import('./pages/Team.jsx'));
const Usage = lazy(() => import('./pages/Usage.jsx'));

// The admin console lives at /app/admin; these addresses used to (or look like they should) lead there.
function AdminRest() {
  const { '*': rest } = useParams();
  return <Navigate to={`/app/admin${rest ? `/${rest}` : ''}`} replace />;
}

export default function App() {
  const { pathname } = useLocation();
  return (
    <AppErrorBoundary resetKey={pathname}>
      <ConfirmProvider>
        <Suspense fallback={<FullPageSpinner />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/status/:slug" element={<PublicStatus />} />
            <Route path="/bot" element={<Bot />} />
            <Route path="/admin/*" element={<AdminRest />} />
            {/* Outside GuestRoute: it restores the session itself, then honours ?next. */}
            <Route path="/auth/callback" element={<AuthCallback />} />

            <Route element={<GuestRoute />}>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
            </Route>

            <Route path="/app" element={<ProtectedRoute />}>
              <Route index element={<AppIndex />} />
              {/* The platform admin console: its own layout, and for administrators only.
                  A static segment outranks :wid below. */}
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<AdminOverview />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="users/:id" element={<AdminUserDetail />} />
                <Route path="workspaces" element={<AdminWorkspaces />} />
                <Route path="workspaces/:id" element={<AdminWorkspaceDetail />} />
                <Route path="monitors" element={<AdminMonitors />} />
                <Route path="incidents" element={<AdminIncidents />} />
                <Route path="incidents/:id" element={<AdminIncidentDetail />} />
                <Route path="system" element={<AdminSystem />} />
                <Route path="audit" element={<AdminAuditLog />} />
                <Route path="*" element={<NotFound />} />
              </Route>
              <Route path=":wid" element={<AppLayout />}>
                <Route path="admin/*" element={<AdminRest />} />
                <Route index element={<Dashboard />} />
                <Route path="monitors/new" element={<NewMonitor />} />
                <Route path="import/github" element={<GithubImport />} />
                <Route path="monitors/:mid" element={<MonitorDetail />} />
                <Route path="monitors/:mid/edit" element={<EditMonitor />} />
                <Route path="incidents" element={<Incidents />} />
                <Route path="alerts" element={<AlertChannels />} />
                <Route path="status-pages" element={<StatusPages />} />
                <Route path="usage" element={<Usage />} />
                <Route path="team" element={<Team />} />
                <Route path="settings" element={<Settings />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ConfirmProvider>
    </AppErrorBoundary>
  );
}
