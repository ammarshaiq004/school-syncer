"use client";

import { campusScope, useSession } from "./session";
import { useApi } from "./use-api";

interface ClassWithSections {
  id: string;
  name: string;
  campus: { id: string; name: string };
  sections: { id: string; name: string; classTeacher?: { id: string } | null }[];
}

/**
 * Every section as "Grade 5 A" options (with the campus when there are several), for pickers.
 * `campusScoped` keeps only the campuses the signed-in user's roles cover, so a
 * campus-scoped user is not offered sections the API would refuse. `enabled`
 * false skips the request (for pickers only some roles use).
 */
export function useSectionOptions({ campusScoped = false, enabled = true }: { campusScoped?: boolean; enabled?: boolean } = {}) {
  const user = useSession();
  const classes = useApi<ClassWithSections[]>(enabled ? "/classes" : null);
  const scope = campusScoped ? campusScope(user) : null;
  const list = (classes.data ?? []).filter((c) => !scope || scope.includes(c.campus.id));
  // Campuses often reuse class names, so name the campus once there is more than one.
  const multiCampus = new Set(list.map((c) => c.campus.name)).size > 1;
  const options = list.flatMap((c) =>
    c.sections.map((s) => ({
      value: s.id,
      label: `${c.name} ${s.name}${multiCampus ? `, ${c.campus.name}` : ""}`,
      classId: c.id,
      campusId: c.campus.id,
      campus: c.campus.name,
    })),
  );
  return { options, classes: list, error: classes.error };
}
