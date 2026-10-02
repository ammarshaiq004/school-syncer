import { Redirect } from 'expo-router';
import { Loading } from '@/components/ui';
import { hasRole, useSession } from '@/lib/session';

/** Sends people to the right home: parents to their children, staff to today's classes. */
export default function Index() {
  const { user, loading } = useSession();
  if (loading) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  if (hasRole(user, ['PARENT']) && !user.roles.some((r) => r.role !== 'PARENT')) return <Redirect href="/parent" />;
  return <Redirect href="/teacher" />;
}
