import Constants from 'expo-constants';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Badge, Body, Button, Card, colors, ErrorText, H2, Input, Muted, Notice, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { day } from '@/lib/format';
import { recentScreens } from '@/lib/screens';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

type Status = 'NEW' | 'IN_PROGRESS' | 'FIXED' | 'WONT_FIX';

interface Report {
  id: string;
  message: string;
  page: string;
  status: Status;
  createdAt: string;
  history: { status: Status; at: string }[];
}

const STATUS: Record<Status, { label: string; tone: 'blue' | 'amber' | 'green' | 'red' }> = {
  NEW: { label: 'New', tone: 'blue' },
  IN_PROGRESS: { label: 'In progress', tone: 'amber' },
  FIXED: { label: 'Fixed', tone: 'green' },
  WONT_FIX: { label: "Won't fix", tone: 'red' },
};

const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';
const PHONE = `${Platform.OS} ${Platform.Version}`;

/** "/teacher/attendance/abc" -> "teacher/attendance" (ids say nothing to the reader). */
const screenName = (path: string) =>
  path
    .split('/')
    .filter((p) => p && !/^[a-z0-9]{20,}$/i.test(p))
    .join('/') || 'home';

/**
 * Account (SCHOOL-150): who is signed in, "Report a problem" with the screen,
 * app version and phone, the user's own reports and where SchoolSyncer has
 * got to with them, and signing out.
 */
export default function Account() {
  const { user, signOut } = useSession();
  const reports = useApi<{ items: Report[] }>('/problem-reports');
  const screens = recentScreens();
  const [screen, setScreen] = useState(screens[0] ?? '/');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  async function send() {
    setSending(true);
    setError('');
    setSent('');
    try {
      await api('/problem-reports', {
        method: 'POST',
        body: { message, page: screenName(screen), source: 'MOBILE', appVersion: APP_VERSION, browser: PHONE },
      });
      setMessage('');
      setSent('Thank you. Your report was sent to SchoolSyncer.');
      reports.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen onRefresh={reports.reload} refreshing={reports.refreshing}>
      <Card>
        <H2>{user?.name}</H2>
        <Muted>{[...new Set(user?.roles.map((r) => r.role.charAt(0) + r.role.slice(1).toLowerCase().replace(/_/g, ' ')))].join(', ')}</Muted>
        <Muted>App version {APP_VERSION}</Muted>
      </Card>

      <Card>
        <H2>Report a problem</H2>
        <Muted>Tell SchoolSyncer what went wrong. Your role, school, app version and phone are sent with it.</Muted>
        {screens.length > 0 && (
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: colors.text }}>Which screen?</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {screens.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setScreen(s)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: s === screen }}
                  style={{
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: s === screen ? colors.brand : colors.border,
                    backgroundColor: s === screen ? colors.brandSoft : colors.card,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ color: s === screen ? colors.brand : colors.text, fontSize: 13 }}>{screenName(s)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <Input
          label="What went wrong?"
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={5}
          maxLength={4000}
          style={{ minHeight: 110, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 16, color: colors.text, backgroundColor: colors.card }}
          placeholder="What you were doing and what happened"
        />
        <ErrorText>{error}</ErrorText>
        <Notice>{sent}</Notice>
        <Button title={sending ? 'Sending...' : 'Send report'} onPress={send} disabled={sending || message.trim().length < 5} />
      </Card>

      <Card>
        <H2>My reports</H2>
        <ErrorText>{reports.error}</ErrorText>
        {reports.data?.items.length === 0 && <Muted>You have not reported anything.</Muted>}
        {reports.data?.items.map((r) => (
          <View key={r.id} style={{ gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Body>{r.message}</Body>
              </View>
              <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
            </View>
            <Muted>
              {day(r.createdAt, true)} · {r.page}
            </Muted>
            {r.history.map((h) => (
              <Muted key={h.at}>
                {day(h.at, true)}: {STATUS[h.status].label}
              </Muted>
            ))}
          </View>
        ))}
      </Card>

      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}
