"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Button, TextField } from "@/components/ui";

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
      <TextField
        wrapperClassName="min-w-56 flex-1"
        className="font-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal"
        label={label}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="e.g. HVK9H9VCKG"
        required
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
      />
      <Button type="submit" icon={<Search />}>
        Check
      </Button>
    </form>
  );
}
