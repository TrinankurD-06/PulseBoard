import Logo from '../components/Logo.jsx';

// Temporary shell; real forms (React Hook Form + Zod) replace this in phase 2.
export default function AuthPlaceholder({ title }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <Logo />
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-slate-500">Authentication arrives in phase 2.</p>
    </div>
  );
}
