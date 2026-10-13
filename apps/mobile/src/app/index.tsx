import { Redirect } from 'expo-router';
import { Loading } from '@/components/ui';
import { hasRole, useSession } from '@/lib/session';

/** Sends people to the right home: students to their day, parents to their children, staff to today's classes. */
export default function Index() {
  const { user, loading } = useSession();
  if (loading) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  // A password the school issued (login slip, WhatsApp invite) is replaced first.
  if (user.mustChangePassword) return <Redirect href="/change-password" />;
  if (user.roles.length > 0 && user.roles.every((r) => r.role === 'STUDENT')) return <Redirect href="/student" />;
  if (hasRole(user, ['PARENT']) && !user.roles.some((r) => r.role !== 'PARENT')) return <Redirect href="/parent" />;
  return <Redirect href="/teacher" />;
}
