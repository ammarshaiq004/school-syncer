"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Button, buttonClass, TextField } from "@/components/ui";
import { api } from "@/lib/api";

type Step = "request" | "verify" | "done" | "unavailable";

/**
 * Forgot password, for anyone with a mobile number on their school account:
 * a 6-digit code goes to that number on WhatsApp or SMS (whichever the school
 * has), then the user picks a new password. The answer is the same whether
 * or not the number has an account. Schools that cannot send messages send
 * people to the office for a reset.
 */
export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("request");
  const [schoolSlug, setSchoolSlug] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ status: "sent" | "unavailable" }>("/auth/forgot-password", {
        method: "POST",
        body: { schoolSlug: schoolSlug.trim(), phone: phone.trim() },
      });
      setStep(res.status === "unavailable" ? "unavailable" : "verify");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
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
      await api("/auth/reset-password", {
        method: "POST",
        body: { schoolSlug: schoolSlug.trim(), phone: phone.trim(), code: String(form.get("code") ?? "").trim(), newPassword },
      });
      setStep("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const backToSignIn = (
    <Link href="/login" className="font-medium text-brand hover:underline">
      Back to sign in
    </Link>
  );

  if (step === "unavailable") {
    return (
      <AuthShell title="Ask your school office" description="Your school cannot send reset codes yet." footer={backToSignIn}>
        <Alert tone="info">
          Your school has not set up WhatsApp or SMS messages, so we cannot send you a code. Ask the school office to reset your
          password; they will give you a new one to sign in with.
        </Alert>
      </AuthShell>
    );
  }

  if (step === "done") {
    return (
      <AuthShell title="Password changed" description="You were signed out everywhere else." footer={backToSignIn}>
        <Alert tone="success">Your new password is set. Sign in with your mobile number and the new password.</Alert>
        <Link href="/login" className={buttonClass("primary", "md", "mt-4 w-full")}>
          Sign in
        </Link>
      </AuthShell>
    );
  }

  if (step === "verify") {
    return (
      <AuthShell
        title="Enter the code"
        description={`If ${phone.trim()} is on an account at this school, we sent it a 6-digit code on WhatsApp or SMS. It works for 10 minutes.`}
        footer={backToSignIn}
      >
        <form onSubmit={resetPassword} className="flex flex-col gap-4">
          <TextField
            label="Code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123456"
            required
          />
          <TextField
            label="New password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters, with a letter and a number."
            minLength={8}
            required
          />
          <TextField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" loading={busy} className="mt-1 w-full">
            {busy ? "Saving..." : "Set new password"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => void requestCode()} disabled={busy}>
            Send a new code
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Forgot your password?"
      description="Staff, parents and students with a mobile number on their account can get a reset code. Otherwise ask the school office."
      footer={backToSignIn}
    >
      <form onSubmit={requestCode} className="flex flex-col gap-4">
        <TextField
          label="School code"
          name="schoolSlug"
          value={schoolSlug}
          onChange={(e) => setSchoolSlug(e.target.value)}
          placeholder="demo-school"
          autoComplete="organization"
          required
        />
        <TextField
          label="Mobile number"
          name="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="03001234567"
          autoComplete="tel"
          required
        />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" loading={busy} className="mt-1 w-full">
          {busy ? "Sending..." : "Send code"}
        </Button>
      </form>
    </AuthShell>
  );
}
