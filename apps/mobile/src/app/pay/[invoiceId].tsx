import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Body, Card, colors, ErrorText, H1, H2, Loading, Muted, Screen } from '@/components/ui';
import { day, rupees } from '@/lib/format';
import {
  pendingForms,
  PROVIDER_HINT,
  PROVIDER_LABEL,
  startCheckout,
  type GatewayForm,
  type OnlineProvider,
  type ParentInvoice,
  type PaymentOptions,
} from '@/lib/payments';
import { useApi } from '@/lib/use-api';

/** Pay one voucher: online through a gateway when the school has it, or one of the offline ways. */
export default function PayScreen() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const invoice = useApi<ParentInvoice>(`/parent/invoices/${invoiceId}`);
  // Fails when the school's plan has no online payments; the offline ways still show.
  const options = useApi<PaymentOptions>('/parent/payment-options');
  const [starting, setStarting] = useState<OnlineProvider | null>(null);
  const [error, setError] = useState('');

  const i = invoice.data;
  const due = i?.breakdown.totalDue ?? 0;
  const providers = options.data?.mode === 'off' ? [] : (options.data?.providers ?? []);

  async function payOnline(provider: OnlineProvider) {
    setStarting(provider);
    setError('');
    try {
      const { checkout, action } = await startCheckout(invoiceId, provider);
      if (action.kind === 'form') {
        if (Platform.OS === 'web') {
          postInBrowser(action);
          return;
        }
        pendingForms.set(checkout.id, action);
        router.push({ pathname: '/payment/[id]/gateway', params: { id: checkout.id, provider } });
      } else {
        // 1Bill shows its number there; mock mode lets the parent approve or decline.
        router.push({ pathname: '/payment/[id]', params: { id: checkout.id } });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(null);
    }
  }

  const ref = i?.voucherNo ?? '';
  const ways = [
    { title: 'Bank branch', steps: `Pay at the school's bank and quote voucher no. ${ref}.` },
    { title: 'JazzCash or Easypaisa app', steps: `Choose Bill payment, then Education or School fee, and enter ${ref} as the reference.` },
    { title: '1Bill from any banking app', steps: `Choose 1Bill, then Invoice or Voucher, and enter ${ref} as the reference number.` },
    {
      title: 'School office',
      steps: `Pay in cash at the fee counter${i?.school.phone ? ` (${i.school.phone})` : ''} and collect a receipt.`,
    },
  ];

  return (
    <Screen onRefresh={invoice.reload} refreshing={invoice.refreshing}>
      <ErrorText>{invoice.error}</ErrorText>
      {!i && !invoice.error && <Loading />}
      {i && (
        <>
          <View>
            <H1>{rupees(due)}</H1>
            <Muted>
              {i.student.name} · {i.period}
            </Muted>
            <Muted>
              {due === 0
                ? 'This voucher is paid in full.'
                : i.breakdown.lateFine > 0
                  ? `Includes ${rupees(i.breakdown.lateFine)} late fee`
                  : `Due by ${day(i.dueDate, true)}`}
            </Muted>
          </View>

          <Card>
            <Muted>Voucher no. (reference)</Muted>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text selectable style={styles.mono}>
                {ref}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => Share.share({ message: ref })} hitSlop={8}>
                <Text style={styles.link}>Share</Text>
              </Pressable>
            </View>
          </Card>

          {due > 0 && providers.length > 0 && (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <H2>Pay online now</H2>
                {options.data?.mode === 'mock' && <Muted>Sandbox: no real money moves</Muted>}
              </View>
              {providers.map((p) => (
                <Pressable
                  key={p}
                  accessibilityRole="button"
                  accessibilityLabel={`Pay with ${PROVIDER_LABEL[p]}`}
                  accessibilityHint={PROVIDER_HINT[p]}
                  disabled={starting !== null}
                  onPress={() => payOnline(p)}
                  style={({ pressed }) => [styles.provider, (pressed || starting !== null) && { opacity: 0.6 }]}
                >
                  <Text style={styles.providerTitle}>{starting === p ? 'Starting...' : `Pay with ${PROVIDER_LABEL[p]}`}</Text>
                  <Muted>{PROVIDER_HINT[p]}</Muted>
                </Pressable>
              ))}
              <ErrorText>{error}</ErrorText>
            </Card>
          )}
          {due > 0 && !options.data && !options.error && <Loading />}

          {due > 0 && (
            <Card>
              <H2>{providers.length > 0 ? 'Or pay another way' : 'Ways to pay'}</H2>
              {ways.map((w) => (
                <View key={w.title} style={{ gap: 2 }}>
                  <Body bold>{w.title}</Body>
                  <Muted>{w.steps}</Muted>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

/** Expo web has no WebView: post the signed form from this tab, as the portal does. */
function postInBrowser(action: GatewayForm) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action.url;
  for (const [name, value] of Object.entries(action.fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

const styles = StyleSheet.create({
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 18, color: colors.text },
  link: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  provider: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 2,
    backgroundColor: colors.card,
  },
  providerTitle: { fontSize: 16, fontWeight: '600', color: colors.brand },
});
