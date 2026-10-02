import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Badge, Body, Button, Card, colors, ErrorText, H2, Input, Muted, Notice, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { day, plural, todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

interface Homework { id: string; title: string; details: string | null; dueDate: string; subject: { name: string }; canDelete: boolean }
interface SectionSubject { subject: { id: string; name: string }; teacher: { id: string } | null }

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
};

export default function SectionHomework() {
  const { sectionId, name } = useLocalSearchParams<{ sectionId: string; name?: string }>();
  const list = useApi<Homework[]>(`/homework?sectionId=${sectionId}`);
  const { user } = useSession();
  const subjects = useApi<SectionSubject[]>(`/classes/sections/${sectionId}/subjects`);
  // Subject teachers see their own subjects; a class teacher with none of their own sees them all.
  const mine = (subjects.data ?? []).filter((s) => s.teacher?.id === user?.sub);
  const options = mine.length ? mine : (subjects.data ?? []);
  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [due, setDue] = useState(addDays(1));
  const [tellParents, setTellParents] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!subjectId || title.trim().length < 2) return setError('Choose a subject and write a title.');
    setBusy(true);
    try {
      const res = await api<{ messagesSent: number }>('/homework', {
        method: 'POST',
        body: { sectionId, subjectId, title, details: details || undefined, dueDate: due, sendWhatsApp: tellParents },
      });
      setTitle('');
      setDetails('');
      setError('');
      setNotice(`Homework set.${res.messagesSent ? ` ${plural(res.messagesSent, 'parent')} told on WhatsApp.` : ''}`);
      await list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chip = (selected: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: selected ? colors.brand : colors.border,
    backgroundColor: selected ? colors.brand : colors.card,
  });
  const today = todayIso();

  return (
    <Screen onRefresh={list.reload} refreshing={list.refreshing}>
      <Stack.Screen options={{ title: name ? `Homework · ${name}` : 'Homework' }} />
      <Card>
        <H2>Set homework</H2>
        <Muted>Subject</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {options.map((s) => (
            <Pressable key={s.subject.id} onPress={() => setSubjectId(s.subject.id)} style={chip(subjectId === s.subject.id)} accessibilityRole="button">
              <Text style={{ color: subjectId === s.subject.id ? '#fff' : colors.text }}>{s.subject.name}</Text>
            </Pressable>
          ))}
        </View>
        <Input label="Title" value={title} onChangeText={setTitle} placeholder="Exercise 4.2, questions 1 to 10" />
        <Input label="Details (optional)" value={details} onChangeText={setDetails} multiline />
        <Muted>Due</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[
            ['Today', addDays(0)],
            ['Tomorrow', addDays(1)],
            ['In 2 days', addDays(2)],
            ['Next week', addDays(7)],
          ].map(([label, value]) => (
            <Pressable key={label} onPress={() => setDue(value)} style={chip(due === value)} accessibilityRole="button">
              <Text style={{ color: due === value ? '#fff' : colors.text, fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Body>Tell parents on WhatsApp</Body>
          <Switch value={tellParents} onValueChange={setTellParents} />
        </View>
        <ErrorText>{error}</ErrorText>
        <Notice>{notice}</Notice>
        <Button title={busy ? 'Saving...' : 'Set homework'} onPress={add} disabled={busy} />
      </Card>

      <Card>
        <H2>Recent and upcoming</H2>
        <ErrorText>{list.error}</ErrorText>
        {list.data?.length === 0 && <Muted>Nothing set in the last week.</Muted>}
        {list.data?.map((h) => (
          <View key={h.id} style={{ gap: 2, paddingVertical: 6 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Badge tone="blue">{h.subject.name}</Badge>
              <Muted>{h.dueDate.slice(0, 10) < today ? 'was due' : 'due'} {day(h.dueDate)}</Muted>
            </View>
            <Body bold>{h.title}</Body>
            {h.details ? <Muted>{h.details}</Muted> : null}
          </View>
        ))}
      </Card>
    </Screen>
  );
}
