"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Button, TextField } from "@/components/ui";
import { platformApi, setPlatformToken } from "@/lib/api";

export default function PlatformLoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const res = await platformApi<{ accessToken: string }>("/auth/login", {
        method: "POST",
        body: { email: form.get("email"), password: form.get("password") },
      });
      setPlatformToken(res.accessToken);
      router.push("/platform");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="SchoolSyncer console"
      title="Staff sign in"
      description="For SchoolSyncer staff only. Schools sign in on the main login page."
      aside={
        <div className="mx-auto w-full max-w-md text-slate-300">
          <span className="grid size-11 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <h2 className="mt-5 text-3xl font-semibold leading-tight text-white">Every customer school, plan and bill.</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Manage trials, plans, bills and support access for every school from one place.
          </p>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField label="Email" name="email" type="email" autoComplete="username" required />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" loading={busy} className="mt-1 w-full">
          {busy ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
