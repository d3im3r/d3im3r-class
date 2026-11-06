import { currentUser, needsSetup } from '@/features/auth/server/auth';
import { syncFromPostgres } from '@/features/administration/server/database';
import { Login } from '@/features/auth/components/login';
import { InviteJoin } from '@/features/catalog/components/invite-join';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  await syncFromPostgres();
  const { token } = await params;
  const user = await currentUser();
  if (!user) {
    return <Login setup={await needsSetup()} inviteToken={token} />;
  }
  return <InviteJoin token={token} user={user} />;
}
