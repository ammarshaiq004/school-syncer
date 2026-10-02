import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, View } from 'react-native';
import { Badge, Body, Button, Card, ErrorText, H1, H2, Loading, Muted, Row, Screen, Stat } from '@/components/ui';
import { day, rupees, todayIso } from '@/lib/format';
import type { Child } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function ChildScreen() {
  const { studentId } = useLocalSearchParams<{ studentId: string }>();
  const children = useApi<Child[]>('/parent/children');
  const c = children.data?.find((x) => x.id === studentId);
  const today = todayIso();

  return (
    <Screen onRefresh={children.reload} refreshing={children.refreshing}>
      <Stack.Screen options={{ title: c?.name.split(' ')[0] ?? '' }} />
      <ErrorText>{children.error}</ErrorText>
      {!c && !children.error && <Loading />}
      {c && (
        <>
          <View>
            <H1>{c.name}</H1>
            <Muted>{c.class ?? 'Not enrolled'} · admission no. {c.admissionNo}</Muted>
          </View>

          <Card>
            <H2>Attendance this month</H2>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Stat value={c.attendanceThisMonth.present} label="present" />
              <Stat value={c.attendanceThisMonth.absent} label="absent" />
              <Stat value={c.attendanceThisMonth.leave} label="leave" />
            </View>
            {c.attendanceThisMonth.absentDates.length > 0 && (
              <Muted>Absent on {c.attendanceThisMonth.absentDates.map((d) => day(d)).join(', ')}</Muted>
            )}
          </Card>

          <Card>
            <H2>Homework</H2>
            {!c.homework.length && <Muted>No homework right now.</Muted>}
            {c.homework.map((h) => (
              <View key={h.id} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Badge tone="blue">{h.subject}</Badge>
                  <Muted>{h.dueDate < today ? 'was due' : 'due'} {day(h.dueDate)}</Muted>
                </View>
                <Body bold>{h.title}</Body>
                {h.details ? <Muted>{h.details}</Muted> : null}
              </View>
            ))}
          </Card>

          {c.class && (
            <Button variant="ghost" title="View timetable" onPress={() => router.push({ pathname: '/timetable/[studentId]', params: { studentId: c.id } })} />
          )}

          <Card>
            <H2>Results</H2>
            {!c.results.length && <Muted>No results published yet.</Muted>}
            {c.results.map((r) => (
              <Row
                key={r.examId}
                title={r.exam}
                subtitle={`${r.percent}% · grade ${r.grade} · position ${r.position}`}
                right={r.passed ? <Badge tone="green">pass</Badge> : <Badge tone="red">fail</Badge>}
                onPress={() => router.push({ pathname: '/report-card/[examId]/[studentId]', params: { examId: r.examId, studentId: c.id } })}
              />
            ))}
          </Card>

          {c.transport && (
            <Card>
              <H2>School van</H2>
              <Row
                title={c.transport.stop ? `${c.transport.route} · ${c.transport.stop}` : c.transport.route}
                subtitle={[c.transport.pickupTime && `Picked up ${c.transport.pickupTime}`, c.transport.dropTime && `dropped ${c.transport.dropTime}`]
                  .filter(Boolean)
                  .join(', ')}
              />
              {c.transport.driverName && (
                <Row
                  title={`Driver ${c.transport.driverName}`}
                  subtitle={`${c.transport.vehicle ?? ''} · tap to call ${c.transport.driverPhone}`}
                  onPress={() => Linking.openURL(`tel:${c.transport!.driverPhone}`)}
                />
              )}
            </Card>
          )}

          <Card>
            <H2>Fees</H2>
            {!c.unpaidInvoices.length && <Muted>All fees are paid. Thank you.</Muted>}
            {c.unpaidInvoices.map((i) => (
              <Row key={i.id} title={`${i.period} · ${rupees(i.balance)}`} subtitle={`Voucher ${i.voucherNo} · due ${day(i.dueDate, true)}`} />
            ))}
            {c.unpaidInvoices.length > 0 && <Muted>Pay at the bank or by JazzCash or Easypaisa using the voucher number.</Muted>}
          </Card>
        </>
      )}
    </Screen>
  );
}
