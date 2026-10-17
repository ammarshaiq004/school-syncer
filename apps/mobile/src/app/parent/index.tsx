import { router, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { AppFooter } from '@/components/app-footer';
import { Badge, Button, Card, colors, ErrorText, H2, Loading, Muted, Screen, Stat } from '@/components/ui';
import type { Child } from '@/lib/types';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

export default function ParentHome() {
  const { user, signOut } = useSession();
  const children = useApi<Child[]>('/parent/children');

  return (
    <Screen onRefresh={children.reload} refreshing={children.refreshing}>
      <Stack.Screen options={{ title: 'My children', headerRight: () => <Text onPress={signOut} accessibilityRole="button" style={{ color: colors.brand, paddingHorizontal: 12 }}>Sign out</Text> }} />
      <Muted>Assalam-o-alaikum, {user?.name}</Muted>
      <ErrorText>{children.error}</ErrorText>
      {!children.data && !children.error && <Loading />}
      {children.data?.length === 0 && <Muted>No children are linked to your number yet. Please contact the school office.</Muted>}
      {children.data?.map((c) => {
        const due = c.unpaidInvoices.reduce((s, i) => s + i.balance, 0);
        const dueSoon = c.homework.filter((h) => h.dueDate >= new Date().toLocaleDateString('en-CA'));
        return (
          <Card key={c.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <H2>{c.name}</H2>
                <Muted>{c.class ?? 'Not enrolled'} · {c.admissionNo}</Muted>
              </View>
              {due ? <Badge tone="red">fees due</Badge> : <Badge tone="green">fees clear</Badge>}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Stat value={c.attendanceThisMonth.present} label="present" />
              <Stat value={c.attendanceThisMonth.absent} label="absent" />
              <Stat value={dueSoon.length} label="homework" />
            </View>
            <Button title="Open" onPress={() => router.push({ pathname: '/parent/[studentId]', params: { studentId: c.id } })} />
          </Card>
        );
      })}
      <AppFooter />
    </Screen>
  );
}
