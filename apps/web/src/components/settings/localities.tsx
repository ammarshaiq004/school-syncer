"use client";

import { useState, type FormEvent } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardHeader, DataTable, Field, useToast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface Locality {
  id: string;
  name: string;
  students: number;
}

/** The areas students live in, offered as a drop-down on the student form. */
export function Localities({ readOnly }: { readOnly: boolean }) {
  const toast = useToast();
  const list = useApi<Locality[]>("/front-office/localities");
  const [error, setError] = useState("");

  async function addLocality(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      await api("/front-office/localities", { method: "POST", body: { name: new FormData(form).get("name") } });
      form.reset();
      await list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(l: Locality) {
    try {
      await api(`/front-office/localities/${l.id}`, { method: "DELETE" });
      await list.reload();
    } catch (e) {
      toast.error("Could not delete", (e as Error).message);
    }
  }

  const columns: Column<Locality>[] = [
    { id: "name", header: "Locality", cell: (l) => <span className="font-medium">{l.name}</span>, sortValue: (l) => l.name },
    { id: "students", header: "Students", cell: (l) => l.students, align: "right", sortValue: (l) => l.students },
    ...(readOnly
      ? []
      : [{ id: "del", header: "", cell: (l: Locality) => <Button size="sm" variant="ghost" aria-label={`Delete ${l.name}`} icon={<Trash2 />} onClick={() => remove(l)} /> }]),
  ];

  return (
    <Card className="max-w-3xl">
      <CardHeader icon={<MapPin />} title="Localities" description="Areas your students live in. Deleting one only clears it from the students; their address text stays." />
      {!readOnly && (
        <form onSubmit={addLocality} className="mb-4 flex items-end gap-3">
          <div className="flex-1"><Field label="New locality" name="name" required /></div>
          <Button type="submit" icon={<Plus />}>
            Add
          </Button>
        </form>
      )}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <DataTable label="Localities" columns={columns} data={list.data} error={list.error} onRetry={list.reload} getRowId={(l) => l.id} pageSize={0} empty={{ title: "No localities yet" }} />
    </Card>
  );
}
