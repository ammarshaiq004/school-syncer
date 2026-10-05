"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CircleCheck } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Button, TextField } from "@/components/ui";
import { SchoolModePicker, schoolModeLabel, SCHOOL_MODES } from "@/components/school-mode-picker";
import { api, setToken, type SchoolMode } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [schoolCode, setSchoolCode] = useState("");
  const [mode, setMode] = useState<SchoolMode>("PHYSICAL");
  const [step, setStep] = useState<"mode" | "details">("mode");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const res = await api<{ accessToken: string; schoolSlug: string }>("/auth/register-school", {
        method: "POST",
        body: {
          schoolName: form.get("schoolName"),
          city: form.get("city") || undefined,
          ownerName: form.get("ownerName"),
          email: form.get("email"),
          phone: form.get("phone") || undefined,
          password: form.get("password"),
          mode,
        },
      });
      setToken(res.accessToken);
      setSchoolCode(res.schoolSlug);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (schoolCode) {
    return (
      <AuthShell title="Your school is ready" description="Staff use the school code below to sign in.">
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <p className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">School code</p>
            <p className="mt-1 font-mono text-xl font-semibold text-fg">{schoolCode}</p>
          </div>
          <p className="flex items-start gap-2 text-sm text-fg-secondary">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            You have 30 days of the Growth plan free, with every module. Pick a plan under Plan and billing whenever you are
            ready.
          </p>
          <p className="flex items-start gap-2 text-sm text-fg-secondary">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            {mode === "ONLINE"
              ? "Set up as an online school with an Online campus. Add classes, then build courses and schedule live classes."
              : mode === "HYBRID"
                ? "Set up as a hybrid school: campus modules plus courses, live classes, assignments and quizzes."
                : "Set up as a physical school. You can switch on online learning later under System settings."}
          </p>
          <Button type="button" className="w-full" onClick={() => router.push("/dashboard")}>
            Go to dashboard
          </Button>
        </div>
      </AuthShell>
    );
  }

  const footer = (
    <>
      Already registered?{" "}
      <Link href="/login" className="font-medium text-brand hover:underline">
        Sign in
      </Link>
    </>
  );

  if (step === "mode") {
    return (
      <AuthShell
        width="md"
        eyebrow="Step 1 of 2"
        title="Register your school"
        description="First, tell us how your school teaches. This decides which modules you see, and you can change it later."
        footer={footer}
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            setStep("details");
          }}
        >
          <SchoolModePicker value={mode} onChange={setMode} layout="stack" hideLegend legend="How your school teaches" />
          <Button type="submit" className="w-full" iconRight={<ArrowRight />}>
            Continue
          </Button>
        </form>
      </AuthShell>
    );
  }

  const ModeIcon = SCHOOL_MODES.find((m) => m.value === mode)!.icon;
  return (
    <AuthShell
      width="md"
      eyebrow="Step 2 of 2"
      title="Register your school"
      description="Free for 30 days with every module. No card needed."
      footer={footer}
    >
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 sm:col-span-2">
          <span className="flex min-w-0 items-center gap-2 text-sm text-fg">
            <ModeIcon className="size-4 shrink-0 text-brand" aria-hidden />
            <span className="truncate">{schoolModeLabel(mode)}</span>
          </span>
          <Button type="button" size="sm" variant="ghost" icon={<ArrowLeft />} onClick={() => setStep("mode")} aria-label="Change how your school teaches">
            Change
          </Button>
        </div>
        <TextField label="School name" name="schoolName" placeholder="Al-Noor Grammar School" required wrapperClassName="sm:col-span-2" />
        <TextField label="City" name="city" placeholder="Lahore" />
        <TextField label="Your name" name="ownerName" placeholder="Farah Siddiqui" required />
        <TextField label="Email" name="email" type="email" autoComplete="email" required wrapperClassName="sm:col-span-2" />
        <TextField label="Phone" name="phone" placeholder="03001234567" autoComplete="tel" />
        <TextField label="Password" name="password" type="password" minLength={8} autoComplete="new-password" hint="At least 8 characters" required />
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
        <Button type="submit" loading={busy} className="w-full sm:col-span-2">
          {busy ? "Creating..." : "Create school"}
        </Button>
      </form>
    </AuthShell>
  );
}
