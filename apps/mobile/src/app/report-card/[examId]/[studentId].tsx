import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Badge, Body, Card, colors, ErrorText, H1, H2, Loading, Muted, Screen, Stat } from '@/components/ui';
import { useApi } from '@/lib/use-api';

interface ReportCard {
  school: { name: string };
  exam: { name: string; academicYear: string };
  student: { name: string; class: string; rollNo: number | null };
  subjects: { subject: string; max: number; marks: number | null; absent: boolean; passed: boolean }[];
  obtained: number;
  maxTotal: number;
  percent: number;
  grade: string;
  position: number;
  outOf: number;
  passed: boolean;
  teacherRemark: string | null;
  principalRemark: string | null;
  attendance: { present: number; absent: number; leave: number };
}

export default function ReportCardScreen() {
  const { examId, studentId } = useLocalSearchParams<{ examId: string; studentId: string }>();
  const card = useApi<ReportCard>(`/exams/${examId}/report-cards/${studentId}`);
  const c = card.data;
  return (
    <Screen onRefresh={card.reload} refreshing={card.refreshing}>
      <ErrorText>{card.error}</ErrorText>
      {!c && !card.error && <Loading />}
      {c && (
        <>
          <View>
            <Muted>{c.school.name} · {c.exam.academicYear}</Muted>
            <H1>{c.exam.name}</H1>
            <Muted>{c.student.name} · {c.student.class}{c.student.rollNo ? ` · roll no. ${c.student.rollNo}` : ''}</Muted>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Stat value={`${c.percent}%`} label="percentage" />
            <Stat value={c.grade} label="grade" />
            <Stat value={`${c.position}/${c.outOf}`} label="position" />
          </View>
          <Card>
            {c.subjects.map((s) => (
              <View key={s.subject} style={styles.line}>
                <Text style={styles.subject}>{s.subject}</Text>
                <Text style={[styles.marks, !s.passed && { color: colors.red }]}>
                  {s.absent ? 'Absent' : `${s.marks} / ${s.max}`}
                </Text>
              </View>
            ))}
            <View style={[styles.line, { borderBottomWidth: 0 }]}>
              <Text style={[styles.subject, { fontWeight: '700' }]}>Total</Text>
              <Text style={[styles.marks, { fontWeight: '700' }]}>{c.obtained} / {c.maxTotal}</Text>
            </View>
            {c.passed ? <Badge tone="green">passed</Badge> : <Badge tone="red">did not pass</Badge>}
          </Card>
          <Card>
            <H2>Remarks</H2>
            <Muted>Class teacher</Muted>
            <Body>{c.teacherRemark || '–'}</Body>
            <Muted>Principal</Muted>
            <Body>{c.principalRemark || '–'}</Body>
          </Card>
          <Muted>Attendance up to the exam: {c.attendance.present} days present, {c.attendance.absent} absent.</Muted>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  subject: { fontSize: 15, color: colors.text },
  marks: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
});
