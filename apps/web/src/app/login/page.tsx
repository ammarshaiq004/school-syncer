"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { api, setToken } from "@/lib/api";

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
      const res = await api<{ accessToken: string }>("/auth/login", {
        method: "POST",
        body: {
          schoolSlug: form.get("schoolSlug"),
          login: form.get("login"),
          password: form.get("password"),
        },
      });
      setToken(res.accessToken);
      router.push("/dashboard");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <Card>
        <h1 className="mb-4 text-2xl font-semibold">Sign in</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="School code" name="schoolSlug" placeholder="demo-school" required />
          <Field label="Email or phone" name="login" required />
          <Field label="Password" name="password" type="password" required />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</Button>
        </form>
        <p className="mt-4 text-sm opacity-70">
          New school? <Link href="/register" className="text-brand underline">Register</Link>
        </p>
      </Card>
    </main>
  );
}
