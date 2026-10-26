export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
      {Icon && (
        <div className="mb-4 rounded-full bg-slate-100 p-3 dark:bg-slate-800">
          <Icon className="h-6 w-6 text-slate-500" aria-hidden="true" />
        </div>
      )}
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
