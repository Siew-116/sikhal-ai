import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * AppHeader — the only navigation in the product.
 *
 * Exactly two screens exist (New Case, Review Resolution), so there is no nav
 * menu, no hamburger, and no dashboard link. The storage indicator is shown
 * honestly: when the app is running on the in-memory adapter, it says so rather
 * than implying durable persistence.
 */
export function AppHeader({
  screenTitle,
  storageLabel,
  storageKind,
  className,
}: {
  screenTitle?: string;
  storageLabel?: string;
  storageKind?: 'supabase' | 'memory';
  className?: string;
}) {
  return (
    <header
      className={cn('sticky top-0 z-40 border-b border-border bg-white/95 backdrop-blur-md', className)}
      
    >
      <div className="sikhal-container flex h-[72px] items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <Link
            href="/"
            className="text-[23px] font-bold tracking-[-0.065em] text-primary"
            aria-label="SikHal home"
          >
            sikhal<span className="text-[#C86B4A]">.</span>
          </Link>
          {screenTitle && (
            <span className="hidden text-body-sm text-text-secondary sm:inline" aria-hidden="true">
              {screenTitle === "New Case" ? "Resolve a problem" : "Review the plan"}
            </span>
          )}
        </div>

        {storageLabel && (
          <span
            className="flex max-w-[60%] items-center gap-1.5 text-caption text-text-muted"
            title={storageLabel}
          >
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background: storageKind === 'supabase' ? 'var(--success)' : 'var(--warning)',
              }}
            />
            <span className="truncate">{storageKind === 'supabase' ? 'Supabase' : 'Session storage'}</span>
          </span>
        )}
      </div>
    </header>
  );
}
