"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Button, Spinner, TextField } from "@/components/ui";
import type { ConsoleAdmin } from "@/components/platform/session";
import { platformApi, setPlatformToken } from "@/lib/api";

/**
 * Choose a new console password. New staff and anyone whose password was
 * reset land here first and cannot use the console until they finish.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<ConsoleAdmin | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    platformApi<ConsoleAdmin>("/auth/me")
      .then(setAdmin)
      .catch(() => router.replace("/platform/login"));
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirm") ?? "")) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // The change ends every other session, this one included; keep the fresh token.
      const res = await platformApi<{ accessToken: string }>("/auth/change-password", {
        method: "POST",
        body: { currentPassword: form.get("currentPassword"), newPassword },
      });
      setPlatformToken(res.accessToken);
      router.replace("/platform");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function signOut() {
    setPlatformToken(null);
    router.replace("/platform/login");
  }

  if (!admin) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg">
        <Spinner label="Loading" />
      </div>
    );
  }

  const forced = admin.mustChangePassword;

  return (
    <AuthShell
      eyebrow="SchoolSyncer console"
      title={forced ? "Choose your password" : "Change password"}
      description={
        forced
          ? `Welcome, ${admin.name}. You signed in with a temporary password. Choose your own to continue.`
          : "You stay signed in on this device; other devices are signed out."
      }
      homeHref="/platform"
      aside={
        <div className="mx-auto w-full max-w-md text-slate-300">
          <span className="grid size-11 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300">
            <KeyRound className="size-5" aria-hidden />
          </span>
          <h2 className="mt-5 text-3xl font-semibold leading-tight text-white">Keep school data safe.</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Console access reaches every customer school. Use a password you do not use anywhere else.
          </p>
        </div>
      }
      footer={
        forced ? (
          <button type="button" onClick={signOut} className="font-medium text-brand hover:underline">
            Sign out instead
          </button>
        ) : (
          <Link href="/platform" className="font-medium text-brand hover:underline">
            Back to the console
          </Link>
        )
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <input type="email" name="username" autoComplete="username" value={admin.email} readOnly hidden />
        <TextField label={forced ? "Temporary password" : "Current password"} name="currentPassword" type="password" autoComplete="current-password" required />
        <TextField
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
          hint="At least 8 characters, with a letter and a number."
        />
        <TextField label="Repeat new password" name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" loading={busy} className="mt-1 w-full">
          Save password
        </Button>
      </form>
    </AuthShell>
  );
}
