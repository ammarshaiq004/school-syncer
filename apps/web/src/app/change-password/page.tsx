"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Button, Spinner, TextField } from "@/components/ui";
import { api, setToken, type SessionUser } from "@/lib/api";
import { hasRole, STAFF } from "@/lib/session";

/** Where a user lands after signing in: staff on the dashboard, families in their portal. */
function homeFor(user: SessionUser) {
  if (hasRole(user, STAFF)) return "/dashboard";
  return hasRole(user, ["STUDENT"]) && !hasRole(user, ["PARENT"]) ? "/student" : "/parent";
}

/**
 * Choose a new password. Anyone whose password was issued by someone else
 * (a new account, a reset, a student login slip, a parent invite on WhatsApp)
 * lands here first and cannot use the app until they finish.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SessionUser>("/auth/me")
      .then(setUser)
      .catch(() => router.replace("/login"));
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
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
      const res = await api<{ accessToken: string }>("/auth/change-password", {
        method: "POST",
        body: { currentPassword: form.get("currentPassword"), newPassword },
      });
      setToken(res.accessToken);
      router.replace(homeFor(user));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function signOut() {
    setToken(null);
    router.replace("/login");
  }

  if (!user) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg">
        <Spinner label="Loading" />
      </div>
    );
  }

  const forced = !!user.mustChangePassword;

  return (
    <AuthShell
      eyebrow={user.school?.name}
      title={forced ? "Choose your password" : "Change password"}
      description={
        forced
          ? `Welcome, ${user.name}. You signed in with a password the school gave you. Choose your own to continue.`
          : "You stay signed in on this device; other devices are signed out."
      }
      homeHref={homeFor(user)}
      footer={
        forced ? (
          <button type="button" onClick={signOut} className="font-medium text-brand hover:underline">
            Sign out instead
          </button>
        ) : (
          <Link href={homeFor(user)} className="font-medium text-brand hover:underline">
            Back to the app
          </Link>
        )
      }
    >
      {user.support ? (
        <Alert tone="warning">A support session cannot change this person&apos;s password.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextField
            label={forced ? "Password you were given" : "Current password"}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
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
      )}
    </AuthShell>
  );
}
