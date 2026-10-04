"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CircleCheck } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Button, TextField } from "@/components/ui";
import { api, setToken } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [schoolCode, setSchoolCode] = useState("");

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
          <Button type="button" className="w-full" onClick={() => router.push("/dashboard")}>
            Go to dashboard
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      width="md"
      title="Register your school"
      description="Free for 30 days with every module. No card needed."
      footer={
        <>
          Already registered?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
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
