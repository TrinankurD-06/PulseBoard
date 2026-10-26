import { useParams } from 'react-router-dom';

export default function Dashboard() {
  const { wid } = useParams();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-slate-500">Workspace {wid}: monitors arrive in phase 3.</p>
    </div>
  );
}
