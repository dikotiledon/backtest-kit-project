/**
 * Skeleton loading components matching the dark theme design system.
 */

export function SkeletonCard() {
  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-4 h-4 rounded bg-gray-700" />
        <div className="w-16 h-2.5 rounded bg-gray-700" />
      </div>
      <div className="w-24 h-6 rounded bg-gray-700 mb-1" />
      <div className="w-20 h-2 rounded bg-gray-700" />
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-5 animate-pulse">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-4 h-4 rounded bg-gray-700" />
        <div className="w-32 h-3 rounded bg-gray-700" />
      </div>
      <div className="h-[220px] flex items-end gap-1 px-4">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-gray-700 rounded-t"
            style={{ height: `${30 + Math.random() * 60}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-5 animate-pulse">
      <div className="w-32 h-3 rounded bg-gray-700 mb-4" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="w-8 h-3 rounded bg-gray-700" />
            <div className="flex-1 h-3 rounded bg-gray-700" />
            <div className="w-16 h-3 rounded bg-gray-700" />
            <div className="w-12 h-3 rounded bg-gray-700" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Full dashboard skeleton matching DashboardPro layout */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonChart />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SkeletonTable rows={4} />
        <SkeletonTable rows={4} />
      </div>
    </div>
  );
}

/** Generic page skeleton */
export function PageSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="w-48 h-5 rounded bg-gray-700" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonTable rows={6} />
    </div>
  );
}
