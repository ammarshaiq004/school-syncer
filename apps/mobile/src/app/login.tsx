import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, ErrorText, Input, Muted } from '@/components/ui';
import { PRIVACY_URL } from '@/lib/app-info';
import { useSession } from '@/lib/session';

export default function Login() {
  const { signIn } = useSession();
  const [school, setSchool] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!school || !login || !password) return setError('Fill in all three fields.');
    setBusy(true);
    try {
      await signIn(school, login, password);
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={styles.logo}>SchoolSyncer</Text>
          <Muted>For parents, students and teachers</Muted>
        </View>
        <Card>
          <Input label="School code" value={school} onChangeText={setSchool} autoCapitalize="none" autoCorrect={false} placeholder="e.g. demo-school" />
          <Input label="Phone, email or username" value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} keyboardType="default" placeholder="03001234567 or admission no." />
          <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry onSubmitEditing={submit} />
          <ErrorText>{error}</ErrorText>
          <Button title={busy ? 'Signing in...' : 'Sign in'} onPress={submit} disabled={busy} />
          <Text onPress={() => router.push('/forgot-password')} accessibilityRole="button" style={styles.link}>
            Forgot password?
          </Text>
          <Muted>Parents get their login from the school on WhatsApp.</Muted>
        </Card>
        {PRIVACY_URL ? (
          <Text onPress={() => Linking.openURL(PRIVACY_URL)} accessibilityRole="link" style={styles.footerLink}>
            Privacy policy
          </Text>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  wrap: { flex: 1, justifyContent: 'center', padding: 20, gap: 24, maxWidth: 480, width: '100%', alignSelf: 'center' },
  logo: { fontSize: 30, fontWeight: '800', color: colors.brand },
  link: { color: colors.brand, textAlign: 'center', paddingVertical: 4 },
  footerLink: { color: colors.muted, textAlign: 'center', fontSize: 13, paddingVertical: 4 },
});
