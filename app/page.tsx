import { redirect } from 'next/navigation';
import { getAuthState } from '@/lib/auth/session';
import { AuthSetupNotice } from '@/components/AuthSetupNotice';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const state = await getAuthState();

  if (state.status === 'unconfigured') {
    return <AuthSetupNotice message={state.message} />;
  }

  if (state.status === 'error') {
    return <AuthSetupNotice message={state.message} variant="error" />;
  }

  if (state.status === 'unauthenticated') {
    redirect('/login');
  }

  return <DashboardClient currentUser={state.user} />;
}
