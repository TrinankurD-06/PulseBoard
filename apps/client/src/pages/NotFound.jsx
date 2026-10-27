import { Link } from 'react-router-dom';

export default function NotFound({ message = "The page you're looking for doesn't exist." }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-6xl font-bold text-slate-300 dark:text-slate-700">404</p>
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-slate-500">{message}</p>
      <Link to="/app" className="text-brand-600 hover:underline dark:text-brand-400">
        Go to your dashboard
      </Link>
    </div>
  );
}
