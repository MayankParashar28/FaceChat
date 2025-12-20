import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton() {
    return (
        <div className="flex h-screen w-full bg-background overflow-hidden">
            {/* Sidebar Skeleton */}
            <div className="hidden md:flex w-[16rem] flex-col border-r border-white/5 bg-white/[0.03] p-4 md:p-6 gap-6">
                {/* Logo area */}
                <div className="flex items-center gap-3 px-2 mb-4">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-6 w-24" />
                </div>

                {/* Menu items */}
                <div className="space-y-4">
                    <Skeleton className="h-4 w-12 ml-2" />
                    <div className="space-y-2">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <Skeleton key={i} className="h-10 w-full rounded-xl" />
                        ))}
                    </div>
                </div>

                {/* User profile at bottom */}
                <div className="mt-auto pt-6 border-t border-white/10">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-3 w-32" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Skeleton */}
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Header Skeleton */}
                <header className="flex items-center justify-between gap-4 p-4 md:p-6 border-b border-white/5 h-16 md:h-20">
                    <div className="flex items-center gap-4">
                        <Skeleton className="h-8 w-8 rounded-md md:hidden" /> {/* Mobile Toggle */}
                        <div className="hidden md:block w-72">
                            <Skeleton className="h-10 w-full rounded-full" />
                        </div>
                    </div>
                    <Skeleton className="h-9 w-9 rounded-md" /> {/* Theme Toggle */}
                </header>

                {/* Page Content Skeleton */}
                <main className="flex-1 p-4 md:p-6 space-y-6 overflow-y-auto">
                    {/* Title / Breadcrumb */}
                    <Skeleton className="h-8 w-48 rounded-md" />

                    {/* Grid of cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
                        ))}
                    </div>

                    {/* Large content block */}
                    <Skeleton className="h-64 w-full rounded-2xl" />
                </main>
            </div>
        </div>
    );
}
