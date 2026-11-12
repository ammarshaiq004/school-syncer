export interface LocalityStudent {
  localityId: string | null;
  localityName: string | null;
  gender: string;
}

/** Active students per locality (students with no locality grouped last), biggest first. */
export function localitySummary(students: LocalityStudent[]) {
  const rows = new Map<string, { id: string | null; name: string; total: number; boys: number; girls: number }>();
  for (const s of students) {
    const key = s.localityId ?? '';
    const row = rows.get(key) ?? { id: s.localityId, name: s.localityName ?? 'No locality set', total: 0, boys: 0, girls: 0 };
    row.total += 1;
    if (s.gender === 'MALE') row.boys += 1;
    if (s.gender === 'FEMALE') row.girls += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.total - a.total || a.name.localeCompare(b.name)));
}
