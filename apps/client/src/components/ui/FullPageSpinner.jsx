import { Loader2 } from 'lucide-react';

export default function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-brand-500" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
