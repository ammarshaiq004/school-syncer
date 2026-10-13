import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, ErrorText, Input, Muted, Notice } from '@/components/ui';
import { api } from '@/lib/api';

type Step = 'request' | 'verify' | 'done' | 'unavailable';

/**
 * Forgot password: a 6-digit code goes to the mobile number on the account
 * (WhatsApp or SMS, whichever the school has), then a new password. The
 * answer is the same whether or not the number has an account.
 */
export default function ForgotPassword() {
  const [step, setStep] = useState<Step>('request');
  const [school, setSchool] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    if (!school.trim() || !phone.trim()) return setError('Fill in the school code and your mobile number.');
    setBusy(true);
    setError('');
    try {
      const res = await api<{ status: 'sent' | 'unavailable' }>('/auth/forgot-password', {
        method: 'POST',
        body: { schoolSlug: school.trim(), phone: phone.trim() },
      });
      setStep(res.status === 'unavailable' ? 'unavailable' : 'verify');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!code.trim() || !next) return setError('Fill in the code and a new password.');
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { schoolSlug: school.trim(), phone: phone.trim(), code: code.trim(), newPassword: next },
      });
      setStep('done');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title = { request: 'Forgot your password?', verify: 'Enter the code', done: 'Password changed', unavailable: 'Ask your school office' }[step];

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={styles.title}>{title}</Text>
          </View>
          <Card>
            {step === 'request' && (
              <>
                <Muted>Get a reset code on the mobile number on your account. Without one, ask the school office.</Muted>
                <Input label="School code" value={school} onChangeText={setSchool} autoCapitalize="none" autoCorrect={false} placeholder="e.g. demo-school" />
                <Input label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="03001234567" onSubmitEditing={requestCode} />
                <ErrorText>{error}</ErrorText>
                <Button title={busy ? 'Sending...' : 'Send code'} onPress={requestCode} disabled={busy} />
              </>
            )}
            {step === 'verify' && (
              <>
                <Muted>{`If ${phone.trim()} is on an account at this school, we sent it a 6-digit code on WhatsApp or SMS. It works for 10 minutes.`}</Muted>
                <Input label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" autoComplete="sms-otp" />
                <Input label="New password" value={next} onChangeText={setNext} secureTextEntry />
                <Input label="Repeat new password" value={confirm} onChangeText={setConfirm} secureTextEntry onSubmitEditing={reset} />
                <Muted>At least 8 characters, with a letter and a number.</Muted>
                <ErrorText>{error}</ErrorText>
                <Button title={busy ? 'Saving...' : 'Set new password'} onPress={reset} disabled={busy} />
                <Button title="Send a new code" variant="ghost" onPress={requestCode} disabled={busy} />
              </>
            )}
            {step === 'unavailable' && (
              <Notice>
                Your school has not set up WhatsApp or SMS messages, so we cannot send you a code. Ask the school office to reset your password.
              </Notice>
            )}
            {step === 'done' && <Notice>Your new password is set and other devices were signed out. Sign in with it now.</Notice>}
            <Text onPress={() => router.replace('/login')} accessibilityRole="button" style={styles.link}>
              Back to sign in
            </Text>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 24, maxWidth: 480, width: '100%', alignSelf: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  link: { color: colors.brand, textAlign: 'center', paddingVertical: 8 },
});
