import { Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/components/ui';
import { screenShown } from '@/lib/screens';
import { SessionProvider } from '@/lib/session';
import { UpdateGate } from '@/lib/update-gate';

/** Remembers the screens shown, for "Report a problem". */
function ScreenTracker() {
  const path = usePathname();
  useEffect(() => screenShown(path), [path]);
  return null;
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <UpdateGate>
        <ScreenTracker />
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.card },
            headerTintColor: colors.brand,
            headerTitleStyle: { color: colors.text },
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="change-password" options={{ headerShown: false }} />
          <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
          <Stack.Screen name="parent/index" options={{ title: 'My children' }} />
          <Stack.Screen name="parent/[studentId]" options={{ title: '' }} />
          <Stack.Screen name="report-card/[examId]/[studentId]" options={{ title: 'Report card' }} />
          <Stack.Screen name="timetable/[studentId]" options={{ title: 'Timetable' }} />
          <Stack.Screen name="pay/[invoiceId]" options={{ title: 'Pay fees' }} />
          <Stack.Screen name="payment/[id]/index" options={{ title: 'Payment' }} />
          <Stack.Screen name="payment/[id]/gateway" options={{ title: 'Checkout' }} />
          <Stack.Screen name="student/index" options={{ title: 'Today' }} />
          <Stack.Screen name="teacher/index" options={{ title: 'Today' }} />
          <Stack.Screen name="teacher/attendance/[sectionId]" options={{ title: 'Attendance' }} />
          <Stack.Screen name="teacher/homework/[sectionId]" options={{ title: 'Homework' }} />
          <Stack.Screen name="account" options={{ title: 'Account' }} />
        </Stack>
      </UpdateGate>
    </SessionProvider>
  );
}
