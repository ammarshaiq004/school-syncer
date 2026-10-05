"use client";

import { useApi } from "./use-api";

interface ClassWithSections {
  id: string;
  name: string;
  campus: { name: string };
  sections: { id: string; name: string; classTeacher?: { id: string } | null }[];
}

/** Every section as "Grade 5 A" options (with the campus when there are several), for pickers. */
export function useSectionOptions() {
  const classes = useApi<ClassWithSections[]>("/classes");
  // Campuses often reuse class names, so name the campus once there is more than one.
  const multiCampus = new Set((classes.data ?? []).map((c) => c.campus.name)).size > 1;
  const options = (classes.data ?? []).flatMap((c) =>
    c.sections.map((s) => ({
      value: s.id,
      label: `${c.name} ${s.name}${multiCampus ? `, ${c.campus.name}` : ""}`,
      classId: c.id,
      campus: c.campus.name,
    })),
  );
  return { options, classes: classes.data ?? [], error: classes.error };
}
