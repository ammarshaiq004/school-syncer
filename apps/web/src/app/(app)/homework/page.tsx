"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BookOpen, CalendarClock, NotebookPen, Plus, Trash2, UserRound } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Drawer,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  SelectField,
  SkeletonRows,
  StatusPill,
  TabPanel,
  Tabs,
  TextareaField,
  TextField,
  useToast,
} from "@/components/ui";
import { subjectColor } from "@/components/week-grid";
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

const FORM_ID = "set-homework-form";

export default function HomeworkPage() {
  const toast = useToast();
  const sections = useSectionOptions();
  const [sectionId, setSectionId] = useState("");
  const list = useApi<Homework[]>(sectionId ? `/homework?sectionId=${sectionId}` : null);
  const [subjects, setSubjects] = useState<SectionSubject[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<Homework | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    setSaving(true);
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
      const message = `Homework set.${res.messagesSent ? ` ${res.messagesSent} parents told on WhatsApp.` : ""}`;
      setNotice(message);
      toast.success("Homework set", res.messagesSent ? `${res.messagesSent} parents told on WhatsApp.` : undefined);
      setFormOpen(false);
      await list.reload();
    } catch (e) {
      setError((e as Error).message);
      setNotice("");
    } finally {
      setSaving(false);
    }
  }

  async function remove(h: Homework) {
    setDeleting(true);
    try {
      await api(`/homework/${h.id}`, { method: "DELETE" });
      toast.success("Homework removed", h.title);
      setRemoving(null);
      await list.reload();
    } catch (e) {
      toast.error("Could not remove homework", (e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  const today = todayIso();
  const all = list.data ?? [];
  const upcoming = all.filter((h) => h.dueDate.slice(0, 10) >= today);
  const past = all.filter((h) => h.dueDate.slice(0, 10) < today);
  const sectionLabel = sections.options.find((o) => o.value === sectionId)?.label;

  const renderList = (items: Homework[], emptyTitle: string, emptyText: string) =>
    !items.length ? (
      <EmptyState compact icon={<NotebookPen />} title={emptyTitle} description={emptyText} />
    ) : (
      <ul className="divide-y divide-border">
        {items.map((h) => {
          const due = h.dueDate.slice(0, 10);
          return (
            <li key={h.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
              <span className="mt-0.5 h-10 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: subjectColor(h.subject.name) }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-fg-secondary">{h.subject.name}</span>
                  {due === today ? (
                    <StatusPill status="DUE" label="Due today" />
                  ) : due < today ? (
                    <StatusPill status="PAST" tone="neutral" label="Past" />
                  ) : null}
                </div>
                <p className="mt-0.5 font-medium text-fg">{h.title}</p>
                {h.details && <p className="mt-1 max-w-[65ch] whitespace-pre-line text-sm leading-relaxed text-fg-secondary">{h.details}</p>}
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="size-3.5" aria-hidden />
                    Due {day(h.dueDate)}
                  </span>
                  {h.assignedBy && (
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="size-3.5" aria-hidden />
                      Set by {h.assignedBy.name}
                    </span>
                  )}
                </p>
              </div>
              {h.canDelete && (
                <IconButton size="sm" aria-label={`Remove ${h.title}`} onClick={() => setRemoving(h)}>
                  <Trash2 />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Homework"
        description="Set homework for a section and let parents know on WhatsApp."
        breadcrumbs={[{ label: "Academics" }, { label: "Homework" }]}
        actions={
          <Button type="button" icon={<Plus />} onClick={() => setFormOpen(true)} disabled={!sectionId}>
            Set homework
          </Button>
        }
      />

      <Card padding="sm">
        <SelectField
          label="Section"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          placeholder="Choose a section"
          options={sections.options}
          wrapperClassName="w-full sm:w-72"
        />
      </Card>

      {notice && <Alert tone="success" onDismiss={() => setNotice("")}>{notice}</Alert>}

      {!sectionId ? (
        <Card padding="none">
          <EmptyState icon={<BookOpen />} title="Choose a section" description="Pick a class and section to see its homework and set new work." />
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          {list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : !list.data ? (
            <SkeletonRows rows={4} columns={2} className="p-4" />
          ) : (
            <Tabs
              aria-label="Homework by due date"
              listClassName="px-3 sm:px-4"
              tabs={[
                { value: "upcoming", label: "Upcoming", count: upcoming.length },
                { value: "past", label: "Past week", count: past.length },
              ]}
            >
              <TabPanel value="upcoming" className="pt-0">
                {renderList(
                  upcoming,
                  "Nothing due",
                  `No upcoming homework for ${sectionLabel ?? "this section"}.`,
                )}
                {!all.length && (
                  <div className="flex justify-center pb-6">
                    <Button type="button" variant="secondary" icon={<Plus />} onClick={() => setFormOpen(true)}>
                      Set homework
                    </Button>
                  </div>
                )}
              </TabPanel>
              <TabPanel value="past" className="pt-0">
                {renderList(past, "Nothing from last week", "Homework due in the past week shows up here.")}
              </TabPanel>
            </Tabs>
          )}
        </Card>
      )}

      <Drawer
        open={formOpen}
        onOpenChange={setFormOpen}
        title="Set homework"
        description={sectionLabel ? `For ${sectionLabel}` : undefined}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} disabled={!subjects.length} loading={saving}>
              Set homework
            </Button>
          </>
        }
      >
        <form id={FORM_ID} className="flex flex-col gap-4" onSubmit={add}>
          <SelectField
            label="Subject"
            name="subjectId"
            required
            options={subjects.map((s) => ({ value: s.subject.id, label: s.subject.name }))}
            hint={!subjects.length ? "This section has no subjects yet." : undefined}
          />
          <TextField label="Title" name="title" placeholder="Exercise 4.2, questions 1 to 10" required />
          <TextareaField label="Details (optional)" name="details" rows={4} placeholder="Write neatly in the classwork copy. Show all working." />
          <TextField label="Due" name="dueDate" type="date" min={today} defaultValue={today} required />
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
            <input type="checkbox" name="sendWhatsApp" className="size-4 rounded accent-primary" /> Tell parents on WhatsApp
          </label>
          {error && <Alert tone="danger" title="Could not set homework">{error}</Alert>}
        </form>
      </Drawer>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove homework?"
        description={removing ? `"${removing.title}" will be removed for this section.` : undefined}
        confirmLabel="Remove"
        destructive
        loading={deleting}
        onConfirm={() => removing && remove(removing)}
      />
    </div>
  );
}
