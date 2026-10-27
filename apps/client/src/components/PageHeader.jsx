import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

/**
 * Display headline (Manrope 300, sentence case) with a small muted phrase at
 * baseline level beside it. `description` is the older name for `phrase`.
 */
export default function PageHeader({ title, phrase, description, action }) {
  useDocumentTitle(typeof title === 'string' ? title : undefined);
  const side = phrase ?? description;
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-2">
        <h1 className="text-[clamp(32px,4.5vw,56px)] leading-[1.05] font-light tracking-[-0.03em] text-fg">
          {title}
        </h1>
        {side && <p className="max-w-[38ch] text-sm text-muted">{side}</p>}
      </div>
      {action}
    </div>
  );
}
