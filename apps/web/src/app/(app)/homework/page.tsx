"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Badge, Button, Card, ErrorText, Field, Notice, PageTitle, TextArea } from "@/components/ui";
import { api } from "@/lib/api";
import { day, todayIso } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { useApi } from "@/lib/use-api";

interface Homework {
  id: string;
  title: string;
  details: string | null;
  dueDate: string;
  subject: { name: string };
  assignedBy: { name: string } | null;
  canDelete: boolean;
}
interface SectionSubject { subject: { id: string; name: string } }

export default function HomeworkPage() {
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState("");
  const list = useApi<Homework[]>(sectionId ? `/homework?sectionId=${sectionId}` : null);
  const [subjects, setSubjects] = useState<SectionSubject[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    api<SectionSubject[]>(`/classes/sections/${sectionId}/subjects`)
      .then((s) => !cancelled && setSubjects(s))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [sectionId]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const res = await api<{ messagesSent: number }>("/homework", {
        method: "POST",
        body: {
          sectionId,
          subjectId: f.get("subjectId"),
          title: f.get("title"),
          details: f.get("details") || undefined,
          dueDate: f.get("dueDate"),
          sendWhatsApp: f.get("sendWhatsApp") === "on",
        },
      });
      form.reset();
      setError("");
      setNotice(`Homework set.${res.messagesSent ? ` ${res.messagesSent} parents told on WhatsApp.` : ""}`);
      await list.reload();
    } catch (e) {
      setError((e as Error).message);
      setNotice("");
    }
  }

  async function remove(h: Homework) {
    if (!confirm(`Remove "${h.title}"?`)) return;
    try {
      await api(`/homework/${h.id}`, { method: "DELETE" });
      await list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const today = todayIso();
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Homework</PageTitle>
      <div className="max-w-xs">
        <Select
          label="Section"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          options={[{ value: "", label: "Choose..." }, ...sections.options]}
        />
      </div>
      {sectionId && (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card>
            <h2 className="mb-3 font-semibold">Set and upcoming</h2>
            <ErrorText>{list.error}</ErrorText>
            {list.data?.length === 0 && <p className="text-sm opacity-70">No homework in the last week or coming up.</p>}
            <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
              {list.data?.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="blue">{h.subject.name}</Badge>
                      <span className="font-medium">{h.title}</span>
                    </div>
                    {h.details && <p className="mt-1 whitespace-pre-line text-sm opacity-80">{h.details}</p>}
                    <p className="mt-1 text-xs opacity-60">
                      Due {day(h.dueDate)}{h.dueDate.slice(0, 10) < today ? " (past)" : ""}
                      {h.assignedBy ? ` · set by ${h.assignedBy.name}` : ""}
                    </p>
                  </div>
                  {h.canDelete && <button className="shrink-0 text-sm text-red-600" onClick={() => remove(h)}>Remove</button>}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-4 font-semibold">Set homework</h2>
            <form className="flex flex-col gap-3" onSubmit={add}>
              <Select label="Subject" name="subjectId" required options={subjects.map((s) => ({ value: s.subject.id, label: s.subject.name }))} />
              <Field label="Title" name="title" placeholder="Exercise 4.2, questions 1 to 10" required />
              <TextArea label="Details (optional)" name="details" rows={3} />
              <Field label="Due" name="dueDate" type="date" min={today} defaultValue={today} required />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="sendWhatsApp" /> Tell parents on WhatsApp
              </label>
              <Button type="submit" disabled={!subjects.length}>Set homework</Button>
              {!subjects.length && <p className="text-xs opacity-60">This section has no subjects yet.</p>}
              <Notice>{notice}</Notice>
              <ErrorText>{error}</ErrorText>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
