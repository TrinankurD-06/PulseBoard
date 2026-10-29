import Card from '../ui/Card.jsx';
import Skeleton from '../ui/Skeleton.jsx';

/** Placeholder for the repo groups while GitHub is being read (can take several seconds). */
export default function CandidateSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Looking for sites in your repos">
      {[3, 2].map((rows, group) => (
        <Card key={group} className="overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-40" />
          </div>
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex items-center gap-3 border-t border-line px-5 py-3.5">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-56 max-w-[55%]" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </Card>
      ))}
      <p className="text-sm text-muted">Checking your repos and testing each site…</p>
    </div>
  );
}
