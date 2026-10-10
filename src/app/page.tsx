import { NewCaseScreen } from '@/components/new-case-screen';
import { getRepository } from '@/lib/repo/repository';

/**
 * Screen 1 route — New Case.
 *
 * A server component so the storage adapter is resolved server-side and the UI
 * can be honest about which adapter is backing it.
 */
export default async function NewCasePage() {
  const repo = await getRepository();
  const storage = repo.describe();

  return <NewCaseScreen storageLabel={storage.label} storageKind={storage.kind} />;
}
