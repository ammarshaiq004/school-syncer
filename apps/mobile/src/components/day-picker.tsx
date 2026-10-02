import { Pressable, ScrollView, Text } from 'react-native';
import { colors } from './ui';

const SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A row of weekday chips. */
export function DayPicker({ days, value, onChange }: { days: number[]; value: number; onChange: (d: number) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {days.map((d) => (
        <Pressable
          key={d}
          onPress={() => onChange(d)}
          accessibilityRole="button"
          accessibilityState={{ selected: d === value }}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: d === value ? colors.brand : colors.card,
            borderWidth: 1,
            borderColor: d === value ? colors.brand : colors.border,
          }}
        >
          <Text style={{ color: d === value ? '#fff' : colors.text, fontWeight: '600' }}>{SHORT[d]}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
