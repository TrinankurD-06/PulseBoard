import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export default function PageHeader({ title, description, action }) {
  useDocumentTitle(typeof title === 'string' ? title : undefined);
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
