import { Stack } from 'expo-router';
import { AccountLink } from '@/components/account-link';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { AppFooter } from '@/components/app-footer';
import { Badge, Body, Button, Card, colors, ErrorText, H2, Loading, Muted, Row, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { DAYS } from '@/lib/format';
import type { AssignmentState, LiveState, StudentResults, StudentToday } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const SCHOOL_TZ = 'Asia/Karachi';

/** "9:30 AM" in school time. */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: SCHOOL_TZ });

/** "Tue 6 Oct, 11:59 PM" in school time. */
const dueAt = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: SCHOOL_TZ,
  });

const PROVIDER: Record<StudentToday['liveClasses'][number]['provider'], string> = {
  JITSI: 'Jitsi Meet',
  ZOOM: 'Zoom',
  GOOGLE_MEET: 'Google Meet',
  OTHER: 'Online meeting',
};

const LIVE_BADGE: Record<LiveState, { tone: 'green' | 'red' | 'amber' | 'blue'; label: string }> = {
  live: { tone: 'green', label: 'Live now' },
  upcoming: { tone: 'blue', label: 'Upcoming' },
  ended: { tone: 'amber', label: 'Ended' },
  cancelled: { tone: 'red', label: 'Cancelled' },
};

const WORK_BADGE: Record<AssignmentState, { tone: 'green' | 'red' | 'amber' | 'blue'; label: string }> = {
  pending: { tone: 'blue', label: 'To do' },
  overdue: { tone: 'amber', label: 'Late' },
  missing: { tone: 'red', label: 'Missing' },
  submitted: { tone: 'green', label: 'Submitted' },
  graded: { tone: 'green', label: 'Graded' },
  returned: { tone: 'amber', label: 'Redo' },
};

/** "Due in 5 hours", "Due in 2 days", "Due now". */
function dueIn(hoursLeft: number) {
  if (hoursLeft <= 0) return 'Past due';
  if (hoursLeft < 1) return 'Due within the hour';
  if (hoursLeft < 24) return `Due in ${Math.round(hoursLeft)} hour${Math.round(hoursLeft) === 1 ? '' : 's'}`;
  const days = Math.round(hoursLeft / 24);
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

export default function StudentHome() {
  const today = useApi<StudentToday>('/student/today');
  const results = useApi<StudentResults>('/student/results');
  const [joining, setJoining] = useState<string | null>(null);
  const [joinError, setJoinError] = useState('');

  const refresh = () => Promise.all([today.reload(), results.reload()]);

  async function join(id: string) {
    setJoining(id);
    setJoinError('');
    try {
      const res = await api<{ joinUrl: string }>(`/student/live/${id}/join`, { method: 'POST' });
      await Linking.openURL(res.joinUrl);
      today.reload();
    } catch (e) {
      setJoinError((e as Error).message);
    } finally {
      setJoining(null);
    }
  }

  const t = today.data;
  const live = t?.liveClasses ?? [];
  const due = t?.assignmentsDue ?? [];
  const exams = (results.data?.exams ?? []).slice(0, 3);

  return (
    <Screen onRefresh={refresh} refreshing={today.refreshing || results.refreshing}>
      <Stack.Screen
        options={{
          title: t ? DAYS[t.dayOfWeek] : 'Today',
          headerRight: () => <AccountLink />,
        }}
      />
      <ErrorText>{today.error}</ErrorText>
      {!t && !today.error && <Loading />}
      {t && (
        <>
          <View>
            <Muted>Assalam-o-alaikum,</Muted>
            <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text }}>{t.student.firstName}</Text>
            {t.section && <Muted>{t.section.name}</Muted>}
          </View>

          <Card>
            <H2>Live classes today</H2>
            <ErrorText>{joinError}</ErrorText>
            {!live.length && <Muted>No live classes scheduled for today.</Muted>}
            {live.map((c) => {
              const badge = LIVE_BADGE[c.state];
              return (
                <View
                  key={c.id}
                  style={{ gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    {c.joined && <Badge tone="green">Attended</Badge>}
                  </View>
                  <Body bold>{c.title}</Body>
                  <Muted>
                    {[`${clock(c.startsAt)} to ${clock(c.endsAt)}`, c.subject, c.teacher, PROVIDER[c.provider]]
                      .filter(Boolean)
                      .join(' · ')}
                  </Muted>
                  {c.canJoin && (
                    <Button
                      title={joining === c.id ? 'Opening class...' : c.state === 'live' ? 'Join now' : 'Join class'}
                      onPress={() => join(c.id)}
                      disabled={joining !== null}
                    />
                  )}
                  {!c.canJoin && c.state === 'upcoming' && (
                    <Muted>You can join from 15 minutes before the class starts.</Muted>
                  )}
                  {c.state === 'ended' && c.recordingUrl && (
                    <Button
                      variant="ghost"
                      title="Watch recording"
                      onPress={() => Linking.openURL(c.recordingUrl!)}
                    />
                  )}
                </View>
              );
            })}
          </Card>

          <Card>
            <H2>Assignments due this week</H2>
            {!due.length && <Muted>Nothing due in the next 7 days.</Muted>}
            {due.map((a) => {
              const badge = WORK_BADGE[a.status];
              return (
                <Row
                  key={a.id}
                  title={a.title}
                  subtitle={`${a.subject} · ${a.submittedAt ? `Due ${dueAt(a.dueAt)}` : dueIn(a.hoursLeft)} · ${a.maxPoints} points`}
                  right={<Badge tone={badge.tone}>{badge.label}</Badge>}
                />
              );
            })}
          </Card>
        </>
      )}

      <Card>
        <H2>Latest results</H2>
        <ErrorText>{results.error}</ErrorText>
        {!results.data && !results.error && <Loading />}
        {results.data && !exams.length && <Muted>No exam results published yet.</Muted>}
        {exams.map((r) => (
          <View key={r.examId} style={{ gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Body bold>{r.exam}</Body>
                <Muted>
                  {[
                    `${r.obtained} / ${r.maxTotal}`,
                    `${r.percent}%`,
                    `grade ${r.grade}`,
                    r.position ? `position ${r.position}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Muted>
              </View>
              {r.passed ? <Badge tone="green">Pass</Badge> : <Badge tone="red">Fail</Badge>}
            </View>
            <Muted>
              {r.subjects
                .map((s) => `${s.subject} ${s.absent ? 'absent' : `${s.marks ?? '-'}/${s.max}`}`)
                .join(', ')}
            </Muted>
          </View>
        ))}
      </Card>
      <AppFooter />
    </Screen>
  );
}
