import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="sikhal-container flex min-h-screen flex-col items-center justify-center py-20 text-center">
      <h1 className="text-title font-semibold">That case was not found</h1>
      <p className="mt-3 max-w-prose text-body text-text-secondary">
        It may have been created in a different server session. Session storage does not persist
        across restarts — configure Supabase to keep cases durably.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Start a new case</Link>
      </Button>
    </main>
  );
}
