import { router } from 'expo-router';
import { Text } from 'react-native';
import { colors } from './ui';

/** The header button that opens the account screen (report a problem, sign out). */
export function AccountLink() {
  return (
    <Text onPress={() => router.push('/account')} accessibilityRole="button" style={{ color: colors.brand, paddingHorizontal: 12 }}>
      Account
    </Text>
  );
}
