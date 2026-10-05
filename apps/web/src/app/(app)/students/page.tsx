"use client";

import { Suspense } from "react";
import { LoadingBlock } from "@/components/ui";
import { StudentDirectory } from "@/components/students/student-directory";
import { StudentList } from "@/components/students/student-list";
import { FEES, hasRole, SETUP, useSession } from "@/lib/session";

export default function StudentsPage() {
  const user = useSession();
  // The directory (fees, attendance rates) is for setup roles and accountants; teachers and office staff get the class list.
  if (!hasRole(user, FEES)) return <StudentList />;
  const features = user.plan?.features;
  return (
    <Suspense fallback={<LoadingBlock label="Loading students" />}>
      <StudentDirectory
        perms={{
          setup: hasRole(user, SETUP),
          fees: features?.includes("fees") !== false,
          certificates: features?.includes("certificates") !== false,
        }}
      />
    </Suspense>
  );
}
