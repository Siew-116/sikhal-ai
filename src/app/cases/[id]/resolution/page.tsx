import { notFound } from 'next/navigation';
import { ReviewResolutionScreen } from '@/components/review-resolution-screen';
import { getRepository } from '@/lib/repo/repository';

/**
 * Screen 2 route — Review Resolution.
 */
export default async function ResolutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const repo = await getRepository();

  const caseRecord = await repo.getCase(id);
  if (!caseRecord) notFound();

  const resolution = await repo.getResolutionForCase(id);
  if (!resolution) notFound();

  const commitments = await repo.listCommitments();
  const storage = repo.describe();

  return (
    <ReviewResolutionScreen
      caseRecord={caseRecord}
      initialResolution={resolution}
      commitments={commitments}
      storageLabel={storage.label}
      storageKind={storage.kind}
    />
  );
}
