import { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HealthStatus {
    status: 'healthy' | 'unhealthy' | 'unknown';
    database?: string;
    state?: string;
    error?: string;
}

export function ServerStatus() {
    const [health, setHealth] = useState<HealthStatus>({ status: 'unknown' });
    const [isVisible, setIsVisible] = useState(false);
    const [isChecking, setIsChecking] = useState(false);

    const checkHealth = async () => {
        setIsChecking(true);
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const res = await fetch('/api/health', {
                signal: controller.signal,
                headers: { 'Cache-Control': 'no-cache' }
            });

            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                setHealth(data);
                if (data.status === 'healthy') {
                    // Hide after 3 seconds if previously visible/unhealthy
                    setTimeout(() => setIsVisible(false), 3000);
                } else {
                    setIsVisible(true);
                }
            } else {
                setHealth({
                    status: 'unhealthy',
                    error: `Server returned ${res.status} ${res.statusText}`
                });
                setIsVisible(true);
            }
        } catch (error: any) {
            setHealth({
                status: 'unhealthy',
                error: error.message || 'Connection failed'
            });
            setIsVisible(true);
        } finally {
            setIsChecking(false);
        }
    };

    useEffect(() => {
        // Check immediately on mount
        checkHealth();

        // Poll every 30 seconds
        const interval = setInterval(checkHealth, 30000);
        return () => clearInterval(interval);
    }, []);

    if (!isVisible && health.status === 'healthy') return null;

    return (
        <div className={cn(
            "fixed bottom-4 right-4 z-[9999] max-w-md w-full p-4 rounded-lg shadow-lg border transition-all duration-300",
            health.status === 'healthy'
                ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300"
                : "bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300"
        )}>
            <div className="flex items-start gap-3">
                {health.status === 'healthy' ? (
                    <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                ) : (
                    <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                )}

                <div className="flex-1">
                    <h3 className="font-semibold text-sm">
                        {health.status === 'healthy' ? 'System Operational' : 'Connection Issue'}
                    </h3>
                    <p className="text-xs mt-1 opacity-90">
                        {health.error || (health.status === 'healthy'
                            ? 'Server and database connections are healthy.'
                            : `DB State: ${health.state || 'Unknown'}`)}
                    </p>

                    {health.status !== 'healthy' && (
                        <div className="mt-2 text-xs bg-black/5 dark:bg-white/5 p-2 rounded font-mono break-all">
                            Debug: {JSON.stringify(health)}
                        </div>
                    )}
                </div>

                <button
                    onClick={checkHealth}
                    disabled={isChecking}
                    className={cn(
                        "p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors",
                        isChecking && "animate-spin"
                    )}
                >
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
