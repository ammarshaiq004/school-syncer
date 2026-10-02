"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { EnquiryFields, enquiryBody, type CampusOption } from "@/components/enquiry-fields";
import { Badge, Button, Card, ErrorText, Notice, PageTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { useApi } from "@/lib/use-api";

interface Application {
  id: string;
  childName: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  source: string | null;
  stage: string;
  testScore: number | null;
  notes: string | null;
  classId: string;
  studentId: string | null;
  createdAt: string;
  campus: { name: string };
  class: { name: string };
}

const STAGES = ["ENQUIRY", "TEST_SCHEDULED", "TEST_DONE", "INTERVIEW", "OFFERED"];
const label = (s: string) => s.replace("_", " ").toLowerCase();

export default function AdmissionsPage() {
  const applications = useApi<Application[]>("/applications");
  const campuses = useApi<{ id: string; name: string }[]>("/campuses");
  const classes = useApi<{ id: string; name: string; campus: { id: string } }[]>("/classes");
  const sections = useSectionOptions();
  const [adding, setAdding] = useState(false);
  const [campusId, setCampusId] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const campusOptions: CampusOption[] = (campuses.data ?? []).map((c) => ({
    ...c,
    classes: (classes.data ?? []).filter((k) => k.campus.id === c.id),
  }));
  const selectedCampus = campusId || campusOptions[0]?.id || "";

  async function run(action: () => Promise<unknown>, done?: string) {
    try {
      await action();
      setError("");
      setNotice(done ?? "");
      await applications.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    await run(async () => {
      await api("/applications", { method: "POST", body: enquiryBody(new FormData(formEl)) });
      formEl.reset();
      setAdding(false);
    }, "Enquiry added.");
  }

  const open = applications.data?.filter((a) => STAGES.includes(a.stage)) ?? [];
  const closed = applications.data?.filter((a) => !STAGES.includes(a.stage)) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle action={<Button onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "New enquiry"}</Button>}>
        Admissions
      </PageTitle>
      <Notice>{notice}</Notice>
      <ErrorText>{error || applications.error}</ErrorText>

      {adding && (
        <Card>
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <EnquiryFields campuses={campusOptions} campusId={selectedCampus} onCampusChange={setCampusId} />
            <div className="flex items-end"><Button type="submit">Save enquiry</Button></div>
          </form>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {STAGES.map((stage) => {
          const items = open.filter((a) => a.stage === stage);
          return (
            <div key={stage} className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-sm font-semibold capitalize">
                {label(stage)} <Badge>{items.length}</Badge>
              </div>
              {items.map((a) => (
                <Card key={a.id} className="p-4">
                  <div className="font-medium">{a.childName}</div>
                  <div className="text-xs opacity-70">{a.class.name} · {a.campus.name}</div>
                  <div className="mt-1 text-xs opacity-70">{a.guardianName} · {a.guardianPhone}</div>
                  <div className="mt-1 text-xs opacity-50">{a.source ?? "Walk-in"} · {day(a.createdAt)}{a.testScore !== null ? ` · test ${a.testScore}` : ""}</div>
                  <div className="mt-3 flex flex-col gap-2">
                    <select
                      value={a.stage}
                      onChange={(e) => run(() => api(`/applications/${a.id}`, { method: "PATCH", body: { stage: e.target.value } }))}
                      className="rounded-lg border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
                    >
                      {[...STAGES, "REJECTED", "WITHDRAWN"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
                    </select>
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const sectionId = new FormData(e.currentTarget).get("sectionId");
                        run(() => api(`/applications/${a.id}/admit`, { method: "POST", body: { sectionId } }), `${a.childName} admitted.`);
                      }}
                    >
                      <select name="sectionId" required className="min-w-0 flex-1 rounded-lg border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20">
                        {sections.options.filter((o) => o.classId === a.classId).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <button className="text-xs font-medium text-brand">Admit</button>
                    </form>
                  </div>
                </Card>
              ))}
            </div>
          );
        })}
      </div>

      <button className="self-start text-sm text-brand" onClick={() => setShowClosed((s) => !s)}>
        {showClosed ? "Hide" : "Show"} admitted, rejected and withdrawn ({closed.length})
      </button>
      {showClosed && (
        <Card>
          <ul className="flex flex-col divide-y divide-black/5 text-sm dark:divide-white/10">
            {closed.map((a) => (
              <li key={a.id} className="flex justify-between py-2">
                <span>{a.childName} · {a.class.name}</span>
                {a.studentId ? (
                  <Link className="text-brand" href={`/students/${a.studentId}`}>admitted</Link>
                ) : (
                  <span className="opacity-60">{label(a.stage)}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
