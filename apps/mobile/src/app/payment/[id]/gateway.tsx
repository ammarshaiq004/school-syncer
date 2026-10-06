import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { Pressable, Text } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { colors, Loading } from '@/components/ui';
import { gatewayPage, isReturnUrl, pendingForms, PROVIDER_LABEL, type OnlineProvider } from '@/lib/payments';

/**
 * The gateway's hosted checkout (JazzCash, Easypaisa) inside the app. When the
 * gateway sends the parent back to the portal, the app takes over and shows the
 * checkout's outcome instead.
 */
export default function GatewayScreen() {
  const { id, provider } = useLocalSearchParams<{ id: string; provider: OnlineProvider }>();
  const form = pendingForms.get(id);
  const done = useRef(false);
  const title = PROVIDER_LABEL[provider] ?? 'Checkout';

  const finish = () => {
    if (done.current) return;
    done.current = true;
    pendingForms.delete(id);
    router.replace({ pathname: '/payment/[id]', params: { id } });
  };

  // The signed form lives in memory only; after an app restart, show where the checkout stands.
  if (!form) return <Redirect href={{ pathname: '/payment/[id]', params: { id } }} />;

  const onNavigation = (nav: Pick<WebViewNavigation, 'url'>) => {
    if (!isReturnUrl(nav.url)) return true;
    finish();
    return false;
  };

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={finish} hitSlop={8}>
              <Text style={{ color: colors.brand, fontSize: 16, fontWeight: '600' }}>Done</Text>
            </Pressable>
          ),
        }}
      />
      <WebView
        source={{ html: gatewayPage(form, title), baseUrl: '' }}
        originWhitelist={['*']}
        startInLoadingState
        renderLoading={() => <Loading />}
        onShouldStartLoadWithRequest={onNavigation}
        // Android does not always ask before following the gateway's redirect back.
        onNavigationStateChange={onNavigation}
        setSupportMultipleWindows={false}
      />
    </>
  );
}
