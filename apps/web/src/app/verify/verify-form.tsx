"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";

export function VerifyForm({ label }: { label: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = code.replace(/[\s-]/g, "").toUpperCase();
    if (clean) router.push(`/verify/${clean}`);
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1">
        <Field label={label} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. HVK9H9VCKG" required autoCapitalize="characters" spellCheck={false} />
      </div>
      <Button type="submit">Check</Button>
    </form>
  );
}
