import { Workspace } from '@/features/catalog/components/workspace';
import { currentUser, needsSetup } from '@/features/auth/server/auth';
import { userCatalog, userProgress } from '@/features/learning/server/access';
import { syncFromPostgres } from '@/features/administration/server/database';
import { Login } from '@/features/auth/components/login';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await syncFromPostgres();
  const user = await currentUser();
  if (!user) return <Login setup={await needsSetup()} />;
  return <Workspace catalog={userCatalog(user)} user={user} initialProgress={userProgress(user)} />;
}
