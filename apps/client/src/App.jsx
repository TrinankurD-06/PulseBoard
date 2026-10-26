import { Route, Routes } from 'react-router-dom';
import { GuestRoute, ProtectedRoute } from './auth/routes.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import AppIndex from './pages/AppIndex.jsx';
import Login from './pages/auth/Login.jsx';
import Register from './pages/auth/Register.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Landing from './pages/Landing.jsx';
import NotFound from './pages/NotFound.jsx';
import PublicStatus from './pages/PublicStatus.jsx';
import Settings from './pages/Settings.jsx';
import Team from './pages/Team.jsx';

export default function App() {
  return (
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
          <Route path="incidents" element={<ComingSoon title="Incidents" />} />
          <Route path="alerts" element={<ComingSoon title="Alert channels" />} />
          <Route path="status-pages" element={<ComingSoon title="Status pages" />} />
          <Route path="team" element={<Team />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
