"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Button, TextField } from "@/components/ui";
import { api, setToken } from "@/lib/api";
import { STAFF } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const res = await api<{ accessToken: string; user?: { roles: { role: string }[] } }>("/auth/login", {
        method: "POST",
        body: {
          schoolSlug: form.get("schoolSlug"),
          login: form.get("login"),
          password: form.get("password"),
        },
      });
      setToken(res.accessToken);
      // Parent-only accounts go straight to their portal.
      const staff = res.user?.roles.some((r) => (STAFF as string[]).includes(r.role)) ?? true;
      router.push(staff ? "/dashboard" : "/parent");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in to your school"
      description="Staff and parents use the same page. Ask your school office for the school code."
      footer={
        <>
          New school?{" "}
          <Link href="/register" className="font-medium text-brand hover:underline">
            Register free for 30 days
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField label="School code" name="schoolSlug" placeholder="demo-school" autoComplete="organization" required />
        <TextField label="Email or phone" name="login" placeholder="you@school.pk or 03001234567" autoComplete="username" required />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" loading={busy} className="mt-1 w-full">
          {busy ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
