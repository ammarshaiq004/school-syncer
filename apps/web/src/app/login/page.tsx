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
      const res = await api<{ accessToken: string; user?: { roles: { role: string }[]; mustChangePassword?: boolean } }>("/auth/login", {
        method: "POST",
        body: {
          schoolSlug: form.get("schoolSlug"),
          login: form.get("login"),
          password: form.get("password"),
        },
      });
      setToken(res.accessToken);
      // A password the school issued must be replaced before anything else.
      if (res.user?.mustChangePassword) {
        router.push("/change-password");
        return;
      }
      // Parents and students go straight to their portal.
      const roles = res.user?.roles.map((r) => r.role) ?? [];
      const staff = !res.user || roles.some((r) => (STAFF as string[]).includes(r));
      const studentOnly = roles.includes("STUDENT") && !roles.includes("PARENT");
      router.push(staff ? "/dashboard" : studentOnly ? "/student" : "/parent");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in to your school"
      description="Staff, parents and students use the same page. Ask your school office for the school code."
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
        <TextField
          label="Email, phone or username"
          name="login"
          placeholder="you@school.pk or 03001234567"
          hint="Students use the username from their login slip (usually the admission number)."
          autoComplete="username"
          required
        />
        <div className="flex flex-col gap-1.5">
          <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
          <Link href="/forgot-password" className="self-end text-[13px] font-medium text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" loading={busy} className="mt-1 w-full">
          {busy ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
