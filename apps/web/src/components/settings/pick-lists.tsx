"use client";

import { useState } from "react";
import { ListChecks, Save } from "lucide-react";
import { Alert, Button, Card, CardHeader, TextareaField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import type { School } from "./school-settings";

/** Lists a school keeps for its own student forms. Fathers' occupations for now. */
export function PickLists({ school, readOnly, onSaved }: { school: School & { occupations?: string[] }; readOnly: boolean; onSaved: (s: School) => void }) {
  const toast = useToast();
  const [text, setText] = useState((school.occupations ?? []).join("\n"));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setError("");
    setSaving(true);
    try {
      const saved = await api<School>("/school", { method: "PATCH", body: { occupations: text.split("\n") } });
      onSaved(saved);
      setText(((saved as { occupations?: string[] }).occupations ?? []).join("\n"));
      toast.success("Saved. These are offered when you enter a guardian.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <CardHeader icon={<ListChecks />} title="Fathers' occupations" description="One per line. They are suggested when you add a guardian, so everyone spells them the same way." />
      <div className="flex flex-col gap-4">
        <TextareaField label="Occupations" rows={10} value={text} disabled={readOnly} onChange={(e) => setText(e.target.value)} placeholder={"Teacher\nShopkeeper\nDriver"} />
        {error && <Alert tone="danger">{error}</Alert>}
        {!readOnly && (
          <div className="flex justify-end border-t border-border pt-4">
            <Button type="button" icon={<Save />} loading={saving} onClick={save}>Save</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
