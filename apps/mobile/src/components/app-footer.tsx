import { Linking, StyleSheet, Text } from 'react-native';
import { APP_BUILD, APP_VERSION, PRIVACY_URL } from '@/lib/app-info';
import { colors } from './ui';

/** Privacy policy link and this build's version, at the bottom of home screens. */
export function AppFooter() {
  return (
    <Text style={styles.footer}>
      {PRIVACY_URL ? (
        <Text onPress={() => Linking.openURL(PRIVACY_URL)} accessibilityRole="link" style={styles.link}>
          Privacy policy
        </Text>
      ) : null}
      {PRIVACY_URL ? '  ·  ' : ''}
      Version {APP_VERSION}
      {APP_BUILD ? ` (${APP_BUILD})` : ''}
    </Text>
  );
}

const styles = StyleSheet.create({
  footer: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 8 },
  link: { color: colors.brand },
});
