import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { DayPicker } from '@/components/day-picker';
import { Card, ErrorText, H2, Loading, Muted, Row, Screen } from '@/components/ui';
import { DAYS, isoWeekday } from '@/lib/format';
import type { Period, Slot } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function ChildTimetable() {
  const { studentId } = useLocalSearchParams<{ studentId: string }>();
  const week = useApi<{ section: { name: string }; periods: Period[]; slots: Slot[] }>(`/timetable/students/${studentId}`);
  const days = [1, 2, 3, 4, 5, ...(week.data?.slots.some((s) => s.dayOfWeek === 6) ? [6] : [])];
  const today = isoWeekday();
  const [dayOfWeek, setDay] = useState(days.includes(today) ? today : 1);

  return (
    <Screen onRefresh={week.reload} refreshing={week.refreshing}>
      <ErrorText>{week.error}</ErrorText>
      {!week.data && !week.error && <Loading />}
      {week.data && (
        <>
          <Muted>{week.data.section.name}</Muted>
          <DayPicker days={days} value={dayOfWeek} onChange={setDay} />
          <Card>
            <H2>{DAYS[dayOfWeek]}</H2>
            {!week.data.periods.length && <Muted>The school hasn&apos;t published a timetable yet.</Muted>}
            {week.data.periods.map((p) => {
              if (p.isBreak) return <Row key={p.id} title={p.name} subtitle={`${p.startTime}–${p.endTime}`} />;
              const slot = week.data!.slots.find((s) => s.dayOfWeek === dayOfWeek && s.periodId === p.id);
              return (
                <Row
                  key={p.id}
                  title={slot ? slot.subject : 'Free'}
                  subtitle={`${p.startTime}–${p.endTime}${slot?.teacher ? ` · ${slot.teacher}` : ''}${slot?.room ? ` · room ${slot.room}` : ''}`}
                />
              );
            })}
          </Card>
        </>
      )}
    </Screen>
  );
}
