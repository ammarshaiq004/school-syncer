import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Badge, Body, Button, Card, colors, ErrorText, H1, H2, Loading, Muted, Row, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { day, rupees } from '@/lib/format';
import {
  CHECKOUT_LABEL,
  CHECKOUT_TONE,
  groupDigits,
  PROVIDER_LABEL,
  type CheckoutDetail,
  type PaymentOptions,
} from '@/lib/payments';
import { useApi } from '@/lib/use-api';

/** Seconds between checks while the gateway has not confirmed yet. */
const POLL_SECONDS = 4;

/** One online checkout: waiting for the gateway, the receipt once paid, or what went wrong. */
export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const payment = useApi<CheckoutDetail>(`/parent/payments/${id}`);
  const options = useApi<PaymentOptions>('/parent/payment-options');
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');

  const p = payment.data;
  const waiting = p?.status === 'PENDING' && !p.expired;
  const { reload } = payment;

  // The gateway may confirm a moment after the parent comes back (and 1Bill whenever they pay).
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(reload, POLL_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  async function simulate(approve: boolean) {
    setActing(true);
    setError('');
    try {
      await api(`/parent/payments/${id}/mock`, { method: 'POST', body: { approve } });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActing(false);
    }
  }

  const backToFees = () => router.dismissTo('/parent');

  return (
    <Screen onRefresh={reload} refreshing={payment.refreshing}>
      <Stack.Screen options={{ title: p?.status === 'PAID' ? 'Receipt' : 'Payment' }} />
      <ErrorText>{payment.error}</ErrorText>
      {!p && !payment.error && <Loading />}
      {p && (
        <>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Badge tone={p.expired ? 'red' : CHECKOUT_TONE[p.status]}>{p.expired ? 'Expired' : CHECKOUT_LABEL[p.status]}</Badge>
              <Muted>{PROVIDER_LABEL[p.provider]}</Muted>
            </View>
            <H1>{rupees(p.amount)}</H1>
            <Muted>
              {p.student.name} · {p.invoice.period} · voucher {p.invoice.voucherNo}
            </Muted>
          </View>

          {p.status === 'PAID' && p.receipt && (
            <Card>
              <H2>Payment received</H2>
              <Muted>Thank you. {p.school.name} has your payment and the voucher is updated.</Muted>
              <Row title="Receipt no." right={<Text selectable style={styles.value}>{p.receipt.receiptNo}</Text>} />
              <Row title="Paid on" right={<Text style={styles.value}>{day(p.receipt.receivedAt, true)}</Text>} />
              {p.providerRef && (
                <Row title={`${PROVIDER_LABEL[p.provider]} ref.`} right={<Text selectable style={styles.value}>{p.providerRef}</Text>} />
              )}
              <Row title="Still due on voucher" right={<Text style={styles.value}>{rupees(p.invoice.balance)}</Text>} />
            </Card>
          )}

          {p.status === 'PENDING' && p.provider === 'ONEBILL' && p.consumerNumber && !p.expired && (
            <Card>
              <H2>Your 1Bill number</H2>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text selectable style={styles.number}>
                  {groupDigits(p.consumerNumber)}
                </Text>
                <Pressable accessibilityRole="button" onPress={() => Share.share({ message: p.consumerNumber! })} hitSlop={8}>
                  <Text style={styles.link}>Share</Text>
                </Pressable>
              </View>
              <Muted>
                In your banking or wallet app choose Bill payment, then 1Bill Invoice or Voucher, and enter this number. The amount is{' '}
                {rupees(p.amount)}. The number works until {day(p.expiresAt, true)}, and this screen updates as soon as your bank
                confirms.
              </Muted>
            </Card>
          )}

          {waiting && p.provider !== 'ONEBILL' && (
            <Card>
              <H2>Waiting for {PROVIDER_LABEL[p.provider]}</H2>
              <Muted>
                {options.data?.mode === 'mock'
                  ? 'This school is in sandbox mode, so no real gateway is called. Approve or decline the payment as the gateway would.'
                  : `If you finished paying, ${PROVIDER_LABEL[p.provider]} usually confirms within a minute. This screen updates by itself.`}
              </Muted>
            </Card>
          )}

          {waiting && options.data?.mode === 'mock' && (
            <Card>
              <H2>Sandbox checkout</H2>
              <Muted>No real money moves.</Muted>
              <Button
                title={p.provider === 'ONEBILL' ? 'Simulate paying from a banking app' : `Approve ${rupees(p.amount)}`}
                disabled={acting}
                onPress={() => simulate(true)}
              />
              <Button title="Decline" variant="ghost" disabled={acting} onPress={() => simulate(false)} />
              <ErrorText>{error}</ErrorText>
            </Card>
          )}

          {(p.status === 'FAILED' || p.expired) && (
            <Card>
              <H2>Payment not completed</H2>
              <Muted>{p.expired ? 'This checkout timed out before the gateway confirmed it.' : (p.message ?? 'The gateway did not take the payment.')}</Muted>
              <Body>
                {p.expired
                  ? 'If you already paid, it will still reach your voucher once the gateway confirms, so check with the school before paying again.'
                  : 'No money was taken for this attempt. You can try again or pay another way.'}
              </Body>
              <Button title="Try again" onPress={() => router.replace({ pathname: '/pay/[invoiceId]', params: { invoiceId: p.invoiceId } })} />
            </Card>
          )}

          {p.status === 'REVIEW' && (
            <Card>
              <H2>Being checked by the fee office</H2>
              <Muted>
                Your payment reached the school, but the fee office needs to check it before it goes on the voucher (for example when the
                voucher was already settled). They will contact you{p.school.phone ? `, or you can call them on ${p.school.phone}` : ''}.
              </Muted>
            </Card>
          )}

          <Button title="Back to my children" variant="ghost" onPress={backToFees} />
        </>
      )}
    </Screen>
  );
}

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const styles = StyleSheet.create({
  value: { fontSize: 15, fontWeight: '600', color: colors.text },
  number: { fontFamily: mono, fontSize: 20, fontWeight: '600', color: colors.text, letterSpacing: 1 },
  link: { color: colors.brand, fontSize: 15, fontWeight: '600' },
});
