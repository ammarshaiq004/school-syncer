"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface Campus {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  _count: { classes: number };
}

export default function CampusesPage() {
  const campuses = useApi<Campus[]>("/campuses");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    try {
      await api("/campuses", {
        method: "POST",
        body: {
          name: form.get("name"),
          address: form.get("address") || undefined,
          phone: form.get("phone") || undefined,
        },
      });
      formEl.reset();
      setError("");
      await campuses.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <h1 className="mb-4 text-xl font-semibold">Campuses</h1>
        <ErrorText>{campuses.error}</ErrorText>
        <table className="w-full text-left text-sm">
          <thead className="opacity-60">
            <tr><th className="py-2">Name</th><th>Address</th><th>Phone</th><th>Classes</th></tr>
          </thead>
          <tbody>
            {campuses.data?.map((c) => (
              <tr key={c.id} className="border-t border-black/5 dark:border-white/10">
                <td className="py-2 font-medium">{c.name}</td>
                <td>{c.address ?? "–"}</td>
                <td>{c.phone ?? "–"}</td>
                <td>{c._count.classes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">Add a campus</h2>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label="Name" name="name" required />
          <Field label="Address" name="address" />
          <Field label="Phone" name="phone" />
          <ErrorText>{error}</ErrorText>
          <Button type="submit">Add campus</Button>
        </form>
      </Card>
    </div>
  );
}
