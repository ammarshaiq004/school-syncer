"use client";

import { useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Button, Card, ErrorText, Field, Notice, PageTitle, TextArea } from "@/components/ui";
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

export default function AnnouncementsPage() {
  const user = useSession();
  const list = useApi<Announcement[]>("/announcements");
  const campuses = useApi<{ id: string; name: string }[]>("/campuses");
  const sections = useSectionOptions();
  const [audience, setAudience] = useState("SCHOOL");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

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
      setNotice(`Announcement posted${res.messages ? ` and sent to ${res.messages} families on WhatsApp` : ""}.`);
      setError("");
      formEl.reset();
      await list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Announcements</PageTitle>
      <div className={`grid gap-6 ${hasRole(user, SETUP) ? "lg:grid-cols-[2fr_1fr]" : ""}`}>
        <div className="flex flex-col gap-3">
          {list.data?.map((a) => (
            <Card key={a.id}>
              <div className="flex justify-between text-xs opacity-60">
                <span>{a.audience.toLowerCase()}</span>
                <span>{day(a.createdAt)}{a.createdBy ? ` · ${a.createdBy.name}` : ""}</span>
              </div>
              <h2 className="mt-1 font-semibold">{a.title}</h2>
              <p className="mt-1 whitespace-pre-line text-sm">{a.body}</p>
            </Card>
          ))}
          {list.data?.length === 0 && <p className="text-sm opacity-60">No announcements yet.</p>}
        </div>
        {hasRole(user, SETUP) && (
          <Card>
            <h2 className="mb-3 font-semibold">New announcement</h2>
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <Field label="Title" name="title" required />
              <TextArea label="Message" name="body" required />
              <Select
                label="Send to"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                options={[
                  { value: "SCHOOL", label: "Whole school" },
                  { value: "CAMPUS", label: "One campus" },
                  { value: "CLASS", label: "One class" },
                  { value: "SECTION", label: "One section" },
                ]}
              />
              {targets.length > 0 && <Select label="Which one" name="targetId" options={targets} />}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="sendWhatsApp" defaultChecked /> Also send to parents on WhatsApp
              </label>
              <Notice>{notice}</Notice>
              <ErrorText>{error}</ErrorText>
              <Button type="submit">Post announcement</Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
