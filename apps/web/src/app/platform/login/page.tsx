"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, Field } from "@/components/ui";
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <Card>
        <p className="text-sm font-medium text-brand">SchoolSyncer console</p>
        <h1 className="mb-4 text-2xl font-semibold">Staff sign in</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Email" name="email" type="email" required />
          <Field label="Password" name="password" type="password" required />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</Button>
        </form>
        <p className="mt-4 text-sm opacity-70">For SchoolSyncer staff only. Schools sign in on the main login page.</p>
      </Card>
    </main>
  );
}
