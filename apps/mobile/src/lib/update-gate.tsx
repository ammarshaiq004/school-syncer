import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, colors, H1, Muted } from '@/components/ui';
import { api, setUpdateRequiredHandler, type UpdateRequired } from './api';
import { APP_PLATFORM, APP_VERSION } from './app-info';
import { getItem, setItem } from './storage';
import { bannerDue, updateStatus } from './version';

interface Release {
  minVersion: string;
  latestVersion: string;
  storeUrl: string;
  message: string;
}

const BANNER_KEY = 'schoolsyncer.updateBannerAt';

const storeName = APP_PLATFORM === 'ios' ? 'the App Store' : 'Google Play';

/**
 * The mobile version gate (docs/api-compatibility.md). Checks /app/version
 * when the app starts and each time it comes back to the foreground:
 * - below the minimum, a full-screen "Update required" that cannot be closed
 *   (also shown when any request is refused with 426 APP_UPDATE_REQUIRED);
 * - below the latest, a banner offering the update, at most once a day.
 * If the check cannot be made (offline, server down) the app carries on.
 * The web preview is never gated.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const [required, setRequired] = useState<UpdateRequired | null>(null);
  const [available, setAvailable] = useState<Release | null>(null);

  const check = useCallback(async () => {
    if (APP_PLATFORM === 'web') return;
    let release: Release | undefined;
    try {
      release = (await api<Record<'ios' | 'android', Release>>('/app/version'))[APP_PLATFORM];
    } catch {
      return; // Fail open: keep whatever we already knew.
    }
    if (!release) return;
    const status = updateStatus(APP_VERSION, release);
    if (status === 'required') {
      setRequired({ message: release.message, minVersion: release.minVersion, storeUrl: release.storeUrl });
      return;
    }
    // The minimum may have been lowered again since a 426.
    setRequired(null);
    if (status === 'current') {
      setAvailable(null);
      return;
    }
    if (bannerDue(await getItem(BANNER_KEY).catch(() => null), Date.now())) {
      setAvailable(release);
      await setItem(BANNER_KEY, String(Date.now())).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    setUpdateRequiredHandler(setRequired);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the check is a network call that sets state when it answers
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      sub.remove();
      setUpdateRequiredHandler(null);
    };
  }, [check]);

  return (
    <>
      {children}
      {available && !required ? <UpdateBanner release={available} onDismiss={() => setAvailable(null)} /> : null}
      {/* A modal sits over every screen; ignoring the back button keeps it from being closed. */}
      <Modal visible={Boolean(required)} animationType="fade" onRequestClose={() => undefined}>
        {required ? <UpdateRequiredScreen info={required} onRetry={check} /> : null}
      </Modal>
    </>
  );
}

function openStore(url: string | undefined) {
  if (url) Linking.openURL(url).catch(() => undefined);
}

function UpdateRequiredScreen({ info, onRetry }: { info: UpdateRequired; onRetry: () => void }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.wrap} accessibilityViewIsModal>
        <Text style={styles.logo}>SchoolSyncer</Text>
        <H1>Update required</H1>
        <Text style={styles.body}>
          {info.message || 'This version of the app is no longer supported. Update SchoolSyncer to carry on.'}
        </Text>
        <Muted>
          You have version {APP_VERSION}
          {info.minVersion ? `; version ${info.minVersion} or newer is needed.` : '.'}
        </Muted>
        {info.storeUrl ? (
          <Button title={`Update from ${storeName}`} onPress={() => openStore(info.storeUrl)} />
        ) : (
          <Muted>Open {storeName}, search for SchoolSyncer and update it.</Muted>
        )}
        <Button title="Check again" variant="ghost" onPress={onRetry} />
      </View>
    </SafeAreaView>
  );
}

function UpdateBanner({ release, onDismiss }: { release: Release; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.banner, { bottom: insets.bottom + 12 }]} accessibilityRole="alert">
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.bannerTitle}>Update available</Text>
        <Text style={styles.bannerText}>{release.message || `Version ${release.latestVersion} is on ${storeName}.`}</Text>
      </View>
      {release.storeUrl ? (
        <Pressable accessibilityRole="button" onPress={() => openStore(release.storeUrl)} style={styles.bannerAction}>
          <Text style={styles.bannerActionText}>Update</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Not now" onPress={onDismiss} hitSlop={8} style={styles.bannerAction}>
        <Text style={[styles.bannerActionText, { color: colors.muted }]}>Not now</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  wrap: { flex: 1, justifyContent: 'center', padding: 24, gap: 16, maxWidth: 480, width: '100%', alignSelf: 'center' },
  logo: { fontSize: 22, fontWeight: '800', color: colors.brand },
  body: { fontSize: 16, color: colors.text, lineHeight: 22 },
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  bannerTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  bannerText: { fontSize: 13, color: colors.muted },
  bannerAction: { paddingHorizontal: 8, paddingVertical: 6 },
  bannerActionText: { fontSize: 15, fontWeight: '600', color: colors.brand },
});
