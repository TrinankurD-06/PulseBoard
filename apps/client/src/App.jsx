import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { GuestRoute, ProtectedRoute } from './auth/routes.jsx';
import FullPageSpinner from './components/ui/FullPageSpinner.jsx';
import Landing from './pages/Landing.jsx';
import NotFound from './pages/NotFound.jsx';

// Route-level code splitting: the landing page and public status pages don't
// download the dashboard (and its charting library), and vice versa.
const AlertChannels = lazy(() => import('./pages/AlertChannels.jsx'));
const AppIndex = lazy(() => import('./pages/AppIndex.jsx'));
const AppLayout = lazy(() => import('./components/layout/AppLayout.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const EditMonitor = lazy(() => import('./pages/monitors/EditMonitor.jsx'));
const Incidents = lazy(() => import('./pages/Incidents.jsx'));
const Login = lazy(() => import('./pages/auth/Login.jsx'));
const MonitorDetail = lazy(() => import('./pages/monitors/MonitorDetail.jsx'));
const NewMonitor = lazy(() => import('./pages/monitors/NewMonitor.jsx'));
const PublicStatus = lazy(() => import('./pages/PublicStatus.jsx'));
const Register = lazy(() => import('./pages/auth/Register.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const StatusPages = lazy(() => import('./pages/StatusPages.jsx'));
const Team = lazy(() => import('./pages/Team.jsx'));

export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/status/:slug" element={<PublicStatus />} />

        <Route element={<GuestRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>

        <Route path="/app" element={<ProtectedRoute />}>
          <Route index element={<AppIndex />} />
          <Route path=":wid" element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="monitors/new" element={<NewMonitor />} />
            <Route path="monitors/:mid" element={<MonitorDetail />} />
            <Route path="monitors/:mid/edit" element={<EditMonitor />} />
            <Route path="incidents" element={<Incidents />} />
            <Route path="alerts" element={<AlertChannels />} />
            <Route path="status-pages" element={<StatusPages />} />
            <Route path="team" element={<Team />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
