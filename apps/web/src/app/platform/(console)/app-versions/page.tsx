"use client";

import { useState } from "react";
import { RotateCcw, Save, Smartphone } from "lucide-react";
import { Alert, Badge, Button, Card, CardFooter, CardHeader, ErrorState, PageHeader, Skeleton, TextareaField, TextField, useToast } from "@/components/ui";
import { isOwner, useConsoleAdmin, when } from "@/components/platform/session";
import { platformApi } from "@/lib/api";
import { compareVersions, isVersion, raisesMinimum } from "@/lib/app-version";
import { usePlatformApi } from "@/lib/use-api";

interface Release {
  minVersion: string;
  latestVersion: string;
  storeUrl: string;
  message: string;
}

interface PlatformRelease extends Release {
  platform: "IOS" | "ANDROID";
  defaults: Release;
  source: "console" | "default";
  updatedAt: string | null;
  updatedBy: string | null;
}

const PLATFORM_LABEL = { IOS: "iPhone (App Store)", ANDROID: "Android (Google Play)" } as const;

function versionError(v: string) {
  return isVersion(v) ? undefined : "Use a version like 1.4.0";
}

function ReleaseEditor({ release, canEdit, onSaved }: { release: PlatformRelease; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Release>({
    minVersion: release.minVersion,
    latestVersion: release.latestVersion,
    // Show only what the console set; an empty field falls back to the default.
    storeUrl: release.source === "console" && release.storeUrl !== release.defaults.storeUrl ? release.storeUrl : "",
    message: release.source === "console" && release.message !== release.defaults.message ? release.message : "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);

  const minError = versionError(draft.minVersion);
  const latestError =
    versionError(draft.latestVersion) ?? ((compareVersions(draft.latestVersion, draft.minVersion) ?? 0) < 0 ? "Cannot be below the minimum" : undefined);
  const locksOut = !minError && raisesMinimum(release.minVersion, draft.minVersion);

  async function save() {
    setError("");
    setBusy("save");
    try {
      await platformApi(`/app-versions/${release.platform}`, { method: "PUT", body: draft });
      toast.success(`${PLATFORM_LABEL[release.platform]} saved`, "Apps pick it up when they next open.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setError("");
    setBusy("reset");
    try {
      await platformApi(`/app-versions/${release.platform}`, { method: "DELETE" });
      toast.success(`${PLATFORM_LABEL[release.platform]} back to the server defaults`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader
        icon={<Smartphone />}
        title={PLATFORM_LABEL[release.platform]}
        description={
          release.source === "console" && release.updatedAt
            ? `Set in the console${release.updatedBy ? ` by ${release.updatedBy}` : ""}, ${when(release.updatedAt)}`
            : "Using the server defaults (APP_* settings)"
        }
        action={<Badge tone={release.source === "console" ? "primary" : "neutral"}>{release.source === "console" ? "Console" : "Default"}</Badge>}
      />
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Minimum version"
            hint="Older builds must update"
            value={draft.minVersion}
            error={minError}
            onChange={(e) => setDraft({ ...draft, minVersion: e.target.value })}
          />
          <TextField
            label="Latest version"
            hint="Older builds are offered it"
            value={draft.latestVersion}
            error={latestError}
            onChange={(e) => setDraft({ ...draft, latestVersion: e.target.value })}
          />
        </div>
        <TextField
          label="Store link"
          type="url"
          placeholder={release.defaults.storeUrl || "https://apps.apple.com/app/id..."}
          hint="Leave empty for the default"
          value={draft.storeUrl}
          onChange={(e) => setDraft({ ...draft, storeUrl: e.target.value })}
        />
        <TextareaField
          label="Message"
          rows={2}
          maxLength={300}
          placeholder={release.defaults.message || "Shown on the update screen and banner"}
          value={draft.message}
          onChange={(e) => setDraft({ ...draft, message: e.target.value })}
        />
        {locksOut && (
          <Alert tone="warning" title="This locks older builds out">
            Phones on versions below {draft.minVersion.trim()} will stop working until they update. Check the store has the new version live first (see
            docs/api-compatibility.md).
          </Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </fieldset>
      {canEdit && (
        <div className="mt-auto">
          <CardFooter className="justify-end gap-2">
            {release.source === "console" && (
              <Button type="button" variant="secondary" icon={<RotateCcw />} loading={busy === "reset"} disabled={busy !== null} onClick={reset}>
                Use defaults
              </Button>
            )}
            <Button type="button" icon={<Save />} loading={busy === "save"} disabled={busy !== null || Boolean(minError || latestError)} onClick={save}>
              Save
            </Button>
          </CardFooter>
        </div>
      )}
    </Card>
  );
}

export default function AppVersionsPage() {
  const { data, error, reload } = usePlatformApi<PlatformRelease[]>("/app-versions");
  const canEdit = isOwner(useConsoleAdmin());
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Mobile app"
        description="The app checks these when it opens. Below the latest version it offers an update once a day; below the minimum it refuses to work until the parent updates."
      />
      {!canEdit && <Alert tone="info">Only a SchoolSyncer owner can change app versions. You can look at them here.</Alert>}
      {error && !data ? (
        <Card padding="none">
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : !data ? (
        <div className="grid gap-6 lg:grid-cols-2" role="status" aria-label="Loading app versions">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-[420px] w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          {data.map((r) => (
            // Keyed on the saved state so a save or reset reloads the form.
            <ReleaseEditor key={`${r.platform}-${r.updatedAt ?? "default"}`} release={r} canEdit={canEdit} onSaved={reload} />
          ))}
        </div>
      )}
    </div>
  );
}
