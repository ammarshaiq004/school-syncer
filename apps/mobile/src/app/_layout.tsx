import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/components/ui';
import { SessionProvider } from '@/lib/session';

export default function RootLayout() {
  return (
    <SessionProvider>
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
        <Stack.Screen name="parent/index" options={{ title: 'My children' }} />
        <Stack.Screen name="parent/[studentId]" options={{ title: '' }} />
        <Stack.Screen name="report-card/[examId]/[studentId]" options={{ title: 'Report card' }} />
        <Stack.Screen name="timetable/[studentId]" options={{ title: 'Timetable' }} />
        <Stack.Screen name="teacher/index" options={{ title: 'Today' }} />
        <Stack.Screen name="teacher/attendance/[sectionId]" options={{ title: 'Attendance' }} />
        <Stack.Screen name="teacher/homework/[sectionId]" options={{ title: 'Homework' }} />
      </Stack>
    </SessionProvider>
  );
}
