import { router, Stack } from 'expo-router';
import { AccountLink } from '@/components/account-link';
import { Text, View } from 'react-native';
import { Badge, Card, ErrorText, H2, Muted, Row, Screen } from '@/components/ui';
import { DAYS, isoWeekday } from '@/lib/format';
import { hasRole, TEACHING, useSession } from '@/lib/session';
import type { Slot } from '@/lib/types';
import { useApi } from '@/lib/use-api';

interface MySection { id: string; name: string; students: number; isClassTeacher: boolean; mySubjects: { id: string; name: string }[] }

export default function TeacherHome() {
  const { user } = useSession();
  const teaches = hasRole(user, TEACHING);
  const slots = useApi<Slot[]>(teaches ? '/timetable/me' : null);
  const sections = useApi<MySection[]>(teaches ? '/attendance/sections' : null);
  const today = isoWeekday();
  const todays = (slots.data ?? []).filter((s) => s.dayOfWeek === today);
  const refresh = () => Promise.all([slots.reload(), sections.reload()]);

  return (
    <Screen onRefresh={refresh} refreshing={slots.refreshing || sections.refreshing}>
      <Stack.Screen options={{ title: DAYS[today], headerRight: () => <AccountLink /> }} />
      <Muted>Assalam-o-alaikum, {user?.name}</Muted>
      {!teaches && (
        <Card>
          <H2>Use the web portal</H2>
          <Muted>The app is for teachers and parents. Your role works best in the SchoolSyncer web portal.</Muted>
        </Card>
      )}
      {teaches && (
        <>
          <Card>
            <H2>Today&apos;s classes</H2>
            <ErrorText>{slots.error}</ErrorText>
            {slots.data && !todays.length && <Muted>No classes on your timetable today.</Muted>}
            {todays.map((s) => (
              <Row key={s.id} title={`${s.subject} · ${s.section}`} subtitle={`${s.period} · ${s.startTime}–${s.endTime}${s.room ? ` · room ${s.room}` : ''}`} />
            ))}
          </Card>
          <Card>
            <H2>My sections</H2>
            <ErrorText>{sections.error}</ErrorText>
            {sections.data && !sections.data.length && <Muted>You are not assigned to any section yet.</Muted>}
            {sections.data?.map((s) => (
              <View key={s.id} style={{ gap: 4 }}>
                <Row
                  title={s.name}
                  subtitle={[`${s.students} students`, ...s.mySubjects.map((x) => x.name)].join(' · ')}
                  right={s.isClassTeacher ? <Badge tone="blue">class teacher</Badge> : undefined}
                  onPress={() => router.push({ pathname: '/teacher/attendance/[sectionId]', params: { sectionId: s.id, name: s.name } })}
                />
                <Text
                  onPress={() => router.push({ pathname: '/teacher/homework/[sectionId]', params: { sectionId: s.id, name: s.name } })}
                  style={{ color: '#1d6fe8', paddingBottom: 6 }}
                  accessibilityRole="link"
                >
                  Homework for {s.name}
                </Text>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
