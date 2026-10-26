import { Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import PublicStatus from './pages/PublicStatus.jsx';
import Register from './pages/Register.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/status/:slug" element={<PublicStatus />} />
      <Route path="/app" element={<AppLayout />}>
        <Route path=":wid" element={<Dashboard />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
