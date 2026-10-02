"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, Field } from "@/components/ui";
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
      const res = await api<{ accessToken: string; schoolSlug: string }>(
        "/auth/register-school",
        {
          method: "POST",
          body: {
            schoolName: form.get("schoolName"),
            city: form.get("city") || undefined,
            ownerName: form.get("ownerName"),
            email: form.get("email"),
            phone: form.get("phone") || undefined,
            password: form.get("password"),
          },
        },
      );
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
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <Card>
          <h1 className="mb-2 text-2xl font-semibold">Your school is ready</h1>
          <p className="mb-4">
            Your school code is <strong>{schoolCode}</strong>. Staff use it to sign in.
          </p>
          <Button onClick={() => router.push("/dashboard")}>Go to dashboard</Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <Card>
        <h1 className="mb-4 text-2xl font-semibold">Register your school</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="School name" name="schoolName" required />
          <Field label="City" name="city" />
          <Field label="Your name" name="ownerName" required />
          <Field label="Email" name="email" type="email" required />
          <Field label="Phone" name="phone" placeholder="03001234567" />
          <Field label="Password" name="password" type="password" minLength={8} required />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy}>{busy ? "Creating..." : "Create school"}</Button>
        </form>
        <p className="mt-4 text-sm opacity-70">
          Already registered? <Link href="/login" className="text-brand underline">Sign in</Link>
        </p>
      </Card>
    </main>
  );
}
