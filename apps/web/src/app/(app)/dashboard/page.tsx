"use client";

import Link from "next/link";
import { Card, ErrorText } from "@/components/ui";
import { useApi } from "@/lib/use-api";

interface School {
  name: string;
  slug: string;
  city: string | null;
  _count: { campuses: number; users: number };
}

export default function DashboardPage() {
  const school = useApi<School>("/school");
  const classes = useApi<{ sections: unknown[] }[]>("/classes");
  const sections = classes.data?.reduce((n, c) => n + c.sections.length, 0) ?? 0;

  const tiles = [
    { label: "Campuses", value: school.data?._count.campuses, href: "/campuses" },
    { label: "Classes", value: classes.data?.length, href: "/classes" },
    { label: "Sections", value: classes.data ? sections : undefined, href: "/classes" },
    { label: "Users", value: school.data?._count.users, href: "/users" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{school.data?.name ?? "Dashboard"}</h1>
        {school.data && (
          <p className="text-sm opacity-70">
            School code: <strong>{school.data.slug}</strong>
            {school.data.city ? ` · ${school.data.city}` : ""}
          </p>
        )}
        <ErrorText>{school.error || classes.error}</ErrorText>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className="hover:border-brand">
              <div className="text-sm opacity-70">{t.label}</div>
              <div className="text-3xl font-semibold">{t.value ?? "–"}</div>
            </Card>
          </Link>
        ))}
      </div>
      <Card>
        <h2 className="mb-2 font-semibold">Set up your school</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Add your campuses.</li>
          <li>Create the academic year, classes and sections.</li>
          <li>Invite principals, admins, accountants and teachers.</li>
        </ol>
      </Card>
    </div>
  );
}
