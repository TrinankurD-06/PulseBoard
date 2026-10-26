import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-6xl font-bold text-slate-300 dark:text-slate-700">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className="text-emerald-600 hover:underline dark:text-emerald-400">
        Back home
      </Link>
    </div>
  );
}
