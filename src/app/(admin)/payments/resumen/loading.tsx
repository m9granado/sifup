export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-3 h-4 w-16 rounded bg-white/10" />
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="h-7 w-48 rounded bg-white/10" />
        <div className="h-9 w-40 rounded bg-white/10" />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 rounded-lg border border-(--border) bg-white/[0.04]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-64 rounded-lg border border-(--border) bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}
