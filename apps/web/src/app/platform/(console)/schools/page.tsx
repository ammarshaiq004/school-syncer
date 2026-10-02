"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, ErrorText, PageTitle, rowClass, tableClass } from "@/components/ui";
import { day, rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { StatusBadge, STATUSES } from "../status";

interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  createdAt: string;
  plan: string | null;
  status: string | null;
  trialEndsAt: string | null;
  students: number;
  campuses: number;
  monthly: number;
  balanceDue: number;
  lastLoginAt: string | null;
}

export default function SchoolsPage() {
  const [search, setSearch] = useState("");
  // Links from the overview pass ?status=... (the console only renders in the browser).
  const [status, setStatus] = useState(() => new URLSearchParams(window.location.search).get("status") ?? "");
  const query = new URLSearchParams({ ...(search && { search }), ...(status && { status }) }).toString();
  const schools = usePlatformApi<SchoolRow[]>(`/schools${query ? `?${query}` : ""}`);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Schools</PageTitle>
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search name, code, city or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status"
          className="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
        >
          <option value="">Every status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>
          ))}
        </select>
      </div>
      <ErrorText>{schools.error}</ErrorText>
      <Card className="overflow-x-auto">
        <table className={tableClass}>
          <thead className="opacity-60">
            <tr>
              <th className="py-2">School</th><th>Plan</th><th>Status</th><th>Students</th><th>Campuses</th>
              <th>Per month</th><th>Owed</th><th>Last sign-in</th><th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {schools.data?.map((s) => (
              <tr key={s.id} className={rowClass}>
                <td className="py-2">
                  <Link href={`/platform/schools/${s.id}`} className="font-medium text-brand hover:underline">{s.name}</Link>
                  <div className="text-xs opacity-60">{s.slug}{s.city && ` · ${s.city}`}</div>
                </td>
                <td>{s.plan ?? "–"}</td>
                <td>
                  <StatusBadge status={s.status} />
                  {s.status === "TRIAL" && s.trialEndsAt && <div className="text-xs opacity-60">until {day(s.trialEndsAt)}</div>}
                </td>
                <td>{s.students.toLocaleString("en-PK")}</td>
                <td>{s.campuses}</td>
                <td>{s.status === "TRIAL" ? <span className="opacity-50">{rupees(s.monthly)}</span> : rupees(s.monthly)}</td>
                <td className={s.balanceDue ? "font-medium text-red-600" : "opacity-50"}>{s.balanceDue ? rupees(s.balanceDue) : "–"}</td>
                <td>{s.lastLoginAt ? day(s.lastLoginAt) : "Never"}</td>
                <td>{day(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {schools.data?.length === 0 && <p className="py-4 text-sm opacity-60">No schools match.</p>}
      </Card>
    </div>
  );
}
