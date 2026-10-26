import { useParams } from 'react-router-dom';

export default function PublicStatus() {
  const { slug } = useParams();
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Status: {slug}</h1>
      <p className="mt-2 text-slate-500">Public status pages arrive in phase 7.</p>
    </div>
  );
}
