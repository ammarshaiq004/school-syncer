"use client";

import { useApi } from "./use-api";

interface ClassWithSections {
  id: string;
  name: string;
  campus: { name: string };
  sections: { id: string; name: string }[];
}

/** Every section as "Grade 5 A" options, for pickers. */
export function useSectionOptions() {
  const classes = useApi<ClassWithSections[]>("/classes");
  const options = (classes.data ?? []).flatMap((c) =>
    c.sections.map((s) => ({ value: s.id, label: `${c.name} ${s.name}`, classId: c.id, campus: c.campus.name })),
  );
  return { options, classes: classes.data ?? [], error: classes.error };
}
