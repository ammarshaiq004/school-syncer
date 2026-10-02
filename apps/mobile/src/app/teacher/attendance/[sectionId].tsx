import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Badge, Button, Card, colors, ErrorText, Loading, Muted, Notice, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { day, plural, todayIso } from '@/lib/format';

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE';
interface Sheet {
  taken: boolean;
  takenBy: string | null;
  students: { id: string; firstName: string; lastName: string | null; rollNo: number | null; status: Status | null }[];
}

const BUTTONS: { status: Status; short: string; color: string }[] = [
  { status: 'PRESENT', short: 'P', color: colors.green },
  { status: 'ABSENT', short: 'A', color: colors.red },
  { status: 'LATE', short: 'L', color: colors.amber },
  { status: 'LEAVE', short: 'Lv', color: colors.muted },
];

export default function TakeAttendance() {
  const { sectionId, name } = useLocalSearchParams<{ sectionId: string; name?: string }>();
  const date = todayIso();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Sheet>(`/attendance/sheet?sectionId=${sectionId}&date=${date}`)
      .then((s) => {
        if (cancelled) return;
        setSheet(s);
        // Everyone starts present, so the teacher only taps the absentees.
        setMarks(Object.fromEntries(s.students.map((st) => [st.id, st.status ?? 'PRESENT'])));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [sectionId, date]);

  async function save() {
    setSaving(true);
    try {
      const res = await api<{ saved: number; counts: Record<Status, number>; alertsSent: number }>('/attendance/sheet', {
        method: 'PUT',
        body: { sectionId, date, records: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })) },
      });
      setNotice(
        `Saved: ${res.counts.PRESENT} present, ${res.counts.ABSENT} absent.` +
          (res.alertsSent ? ` ${plural(res.alertsSent, 'parent')} told on WhatsApp.` : ''),
      );
      setError('');
      setSheet((s) => (s ? { ...s, taken: true } : s));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const absent = Object.values(marks).filter((m) => m === 'ABSENT').length;
  return (
    <Screen>
      <Stack.Screen options={{ title: name ?? 'Attendance' }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Muted>{day(date, true)} · {sheet?.students.length ?? 0} students · {absent} absent</Muted>
        {sheet?.taken && <Badge tone="green">taken</Badge>}
      </View>
      <ErrorText>{error}</ErrorText>
      {!sheet && !error && <Loading />}
      {sheet && (
        <Card>
          {sheet.students.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
              <Text style={{ width: 24, color: colors.muted, textAlign: 'right' }}>{s.rollNo}</Text>
              <Text style={{ flex: 1, fontSize: 15, color: colors.text }}>{[s.firstName, s.lastName].filter(Boolean).join(' ')}</Text>
              {BUTTONS.map((b) => {
                const on = marks[s.id] === b.status;
                return (
                  <Pressable
                    key={b.status}
                    onPress={() => setMarks((m) => ({ ...m, [s.id]: b.status }))}
                    accessibilityRole="button"
                    accessibilityLabel={`${b.status.toLowerCase()} ${s.firstName}`}
                    accessibilityState={{ selected: on }}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: on ? b.color : colors.background,
                    }}
                  >
                    <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '700' }}>{b.short}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {!sheet.students.length && <Muted>No students in this section.</Muted>}
        </Card>
      )}
      <Notice>{notice}</Notice>
      {sheet && !!sheet.students.length && <Button title={saving ? 'Saving...' : 'Save register'} onPress={save} disabled={saving} />}
    </Screen>
  );
}
