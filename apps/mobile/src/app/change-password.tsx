import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, ErrorText, Input, Loading, Muted } from '@/components/ui';
import { useSession } from '@/lib/session';

/**
 * Choose a new password. Students and parents who signed in with the password
 * the school gave them (login slip, WhatsApp invite) land here first.
 */
export default function ChangePassword() {
  const { user, loading, changePassword, signOut } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  const forced = !!user.mustChangePassword;

  async function submit() {
    if (!current || !next) return setError('Fill in both passwords.');
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await changePassword(current, next);
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={styles.title}>{forced ? 'Choose your password' : 'Change password'}</Text>
          <Muted>
            {forced
              ? `Welcome, ${user.name}. You signed in with a password the school gave you. Choose your own to continue.`
              : 'Other devices will be signed out.'}
          </Muted>
        </View>
        <Card>
          <Input label={forced ? 'Password you were given' : 'Current password'} value={current} onChangeText={setCurrent} secureTextEntry />
          <Input label="New password" value={next} onChangeText={setNext} secureTextEntry />
          <Input label="Repeat new password" value={confirm} onChangeText={setConfirm} secureTextEntry onSubmitEditing={submit} />
          <Muted>At least 8 characters, with a letter and a number.</Muted>
          <ErrorText>{error}</ErrorText>
          <Button title={busy ? 'Saving...' : 'Save password'} onPress={submit} disabled={busy} />
          {forced && (
            <Text onPress={signOut} accessibilityRole="button" style={styles.link}>
              Sign out instead
            </Text>
          )}
        </Card>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  wrap: { flex: 1, justifyContent: 'center', padding: 20, gap: 24, maxWidth: 480, width: '100%', alignSelf: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  link: { color: colors.brand, textAlign: 'center', paddingVertical: 8 },
});
