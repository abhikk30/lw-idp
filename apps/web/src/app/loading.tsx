import { Skeleton } from "@lw-idp/ui/components/skeleton";

export default function Loading(): React.ReactNode {
  return (
    <div className="flex flex-col gap-4 p-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-full max-w-2xl" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-64 w-full max-w-3xl" />
    </div>
  );
}
