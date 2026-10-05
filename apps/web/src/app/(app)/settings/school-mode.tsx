"use client";

import { useState } from "react";
import { Info, RotateCw, Shuffle } from "lucide-react";
import { SchoolModePicker, schoolModeLabel } from "@/components/school-mode-picker";
import { Alert, Button, Card, CardHeader, useToast } from "@/components/ui";
import { api, type SchoolMode } from "@/lib/api";

const WHAT_CHANGES: Record<SchoolMode, string> = {
  PHYSICAL: "The menu shows campus modules such as transport, the library desk and ID cards. Courses, live classes, assignments and quizzes are hidden.",
  ONLINE: "The menu shows courses, live classes, assignments and quizzes. Transport, the library desk and ID cards are hidden.",
  HYBRID: "The menu shows everything: campus modules plus courses, live classes, assignments and quizzes.",
};

/** System settings > School mode: how the school teaches, which decides the modules in the menu. */
export function SchoolModeSettings<S extends { id: string; mode?: SchoolMode }>({
  school,
  readOnly,
  onSaved,
}: {
  school: S;
  readOnly: boolean;
  onSaved: (s: S) => void;
}) {
  const toast = useToast();
  const current = school.mode ?? "PHYSICAL";
  const [mode, setMode] = useState<SchoolMode>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedMode, setSavedMode] = useState<SchoolMode | null>(null);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const updated = await api<S>("/school", { method: "PATCH", body: { mode } });
      onSaved({ ...school, ...updated });
      setSavedMode(mode);
      toast.success("School mode saved", schoolModeLabel(mode));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-4xl">
      <CardHeader
        icon={<Shuffle />}
        title="School mode"
        description="How your school teaches. This decides which modules appear in the menu for staff, students and parents."
      />
      <div className="flex flex-col gap-5">
        <SchoolModePicker value={mode} onChange={setMode} disabled={readOnly || busy} hideLegend legend="School mode" />
        <Alert tone="info" icon={<Info />} title={`What ${mode === current ? "you see" : "changes"} with ${schoolModeLabel(mode)}`}>
          {WHAT_CHANGES[mode]} Your records are never deleted: switching back shows them again.
        </Alert>
        {savedMode && (
          <Alert
            tone="success"
            action={
              <Button type="button" size="sm" variant="secondary" icon={<RotateCw />} onClick={() => window.location.reload()}>
                Reload now
              </Button>
            }
          >
            Saved. Reload the page to update your menu; everyone else sees it the next time they open the app.
          </Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        {!readOnly && (
          <div className="flex justify-end">
            <Button type="button" onClick={save} loading={busy} disabled={mode === current}>
              Save school mode
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
