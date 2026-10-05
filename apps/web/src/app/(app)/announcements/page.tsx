"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Building, Layers, Megaphone, Plus, School, Users } from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  SelectField,
  SkeletonCards,
  Tabs,
  TextareaField,
  TextField,
  useToast,
  type Tone,
} from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: string;
  createdAt: string;
  createdBy: { name: string } | null;
}

const AUDIENCES: Record<string, { label: string; short: string; tone: Tone; icon: ReactNode }> = {
  SCHOOL: { label: "Whole school", short: "Whole school", tone: "primary", icon: <School /> },
  CAMPUS: { label: "One campus", short: "Campus", tone: "info", icon: <Building /> },
  CLASS: { label: "One class", short: "Class", tone: "warning", icon: <Layers /> },
  SECTION: { label: "One section", short: "Section", tone: "neutral", icon: <Users /> },
};
const audienceOf = (a: string) => AUDIENCES[a] ?? { label: a, short: a.toLowerCase(), tone: "neutral" as Tone, icon: <Megaphone /> };

const FORM_ID = "new-announcement-form";

export default function AnnouncementsPage() {
  const user = useSession();
  const toast = useToast();
  const canPost = hasRole(user, SETUP);
  const list = useApi<Announcement[]>("/announcements");
  const campuses = useApi<{ id: string; name: string }[]>("/campuses");
  const sections = useSectionOptions();
  const [audience, setAudience] = useState("SCHOOL");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");

  const targets =
    audience === "CAMPUS"
      ? (campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))
      : audience === "CLASS"
        ? sections.classes.map((c) => ({ value: c.id, label: `${c.name} (${c.campus.name})` }))
        : audience === "SECTION"
          ? sections.options
          : [];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    setPosting(true);
    try {
      const res = await api<{ messages: number }>("/announcements", {
        method: "POST",
        body: {
          title: f.get("title"),
          body: f.get("body"),
          audience,
          targetId: f.get("targetId") || undefined,
          sendWhatsApp: f.get("sendWhatsApp") === "on",
        },
      });
      const message = `Announcement posted${res.messages ? ` and sent to ${res.messages} families on WhatsApp` : ""}.`;
      setNotice(message);
      toast.success("Announcement posted", res.messages ? `Sent to ${res.messages} families on WhatsApp.` : undefined);
      setError("");
      formEl.reset();
      setAudience("SCHOOL");
      setFormOpen(false);
      await list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPosting(false);
    }
  }

  const all = [...(list.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (a) => (filter === "ALL" || a.audience === filter) && (!q || `${a.title} ${a.body} ${a.createdBy?.name ?? ""}`.toLowerCase().includes(q)),
  );
  const count = (k: string) => all.filter((a) => a.audience === k).length;
  const newButton = canPost ? (
    <Button type="button" icon={<Plus />} onClick={() => setFormOpen(true)}>
      New announcement
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Announcements"
        description="The school notice board. Posts can go to everyone, one campus, a class or a single section."
        breadcrumbs={[{ label: "Communication" }, { label: "Announcements" }]}
        actions={newButton}
      />

      {notice && <Alert tone="success" onDismiss={() => setNotice("")}>{notice}</Alert>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          variant="pills"
          aria-label="Filter by audience"
          value={filter}
          onValueChange={setFilter}
          tabs={[
            { value: "ALL", label: "All", count: list.data ? all.length : undefined },
            ...Object.entries(AUDIENCES).map(([k, v]) => ({ value: k, label: v.short, count: list.data ? count(k) : undefined })),
          ]}
        />
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder="Search notices"
          wrapperClassName="w-full sm:w-64"
        />
      </div>

      {list.error ? (
        <Card padding="none">
          <ErrorState message={list.error} onRetry={list.reload} />
        </Card>
      ) : !list.data ? (
        <SkeletonCards count={4} className="sm:grid-cols-2 lg:grid-cols-2" />
      ) : !all.length ? (
        <Card padding="none">
          <EmptyState
            icon={<Megaphone />}
            title="No announcements yet"
            description={canPost ? "Post your first notice to share news with staff and families." : "Notices from the school office will show up here."}
            action={newButton}
          />
        </Card>
      ) : !shown.length ? (
        <Card padding="none">
          <EmptyState
            compact
            title="No notices match"
            description="Try another audience or clear the search."
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setFilter("ALL");
                  setQuery("");
                }}
              >
                Show all notices
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Announcements">
          {shown.map((a, i) => {
            const aud = audienceOf(a.audience);
            return (
              <li key={a.id} className="animate-rise">
                <Card className="flex h-full flex-col">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={aud.tone} icon={aud.icon}>
                      {aud.short}
                    </Badge>
                    <div className="flex items-center gap-2">
                      {i === 0 && filter === "ALL" && !q && <Badge tone="primary">Latest</Badge>}
                      <time dateTime={a.createdAt} className="text-xs tabular-nums text-fg-muted">
                        {day(a.createdAt)}
                      </time>
                    </div>
                  </div>
                  <h2 className="mt-3 text-base font-semibold text-fg">{a.title}</h2>
                  <p className="mt-1.5 flex-1 whitespace-pre-line text-sm leading-relaxed text-fg-secondary">{a.body}</p>
                  {a.createdBy && (
                    <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-[13px] text-fg-muted">
                      <Avatar name={a.createdBy.name} size="xs" />
                      Posted by <span className="font-medium text-fg-secondary">{a.createdBy.name}</span>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {canPost && (
        <Drawer
          open={formOpen}
          onOpenChange={setFormOpen}
          title="New announcement"
          description="Posts show on the notice board straight away."
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" form={FORM_ID} loading={posting} icon={<Megaphone />}>
                Post announcement
              </Button>
            </>
          }
        >
          <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4">
            <TextField label="Title" name="title" placeholder="Winter vacation schedule" required />
            <TextareaField label="Message" name="body" rows={6} placeholder="School will remain closed from 22 December to 5 January." required />
            <SelectField
              label="Send to"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              options={Object.entries(AUDIENCES).map(([value, v]) => ({ value, label: v.label }))}
            />
            {targets.length > 0 && <SelectField key={audience} label="Which one" name="targetId" options={targets} />}
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input type="checkbox" name="sendWhatsApp" defaultChecked className="size-4 rounded accent-primary" /> Also send to parents on WhatsApp
            </label>
            {error && <Alert tone="danger" title="Could not post">{error}</Alert>}
          </form>
        </Drawer>
      )}
    </div>
  );
}
