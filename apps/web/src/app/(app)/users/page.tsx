"use client";

import { useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { api, type Role } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface User {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  lastLoginAt: string | null;
  roles: { role: Role; campusId: string | null }[];
}
interface Campus { id: string; name: string }

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "PRINCIPAL", label: "Principal" },
  { value: "ADMIN", label: "Admin / front office" },
  { value: "ACCOUNTANT", label: "Accountant" },
  { value: "TEACHER", label: "Teacher" },
  { value: "CLASS_TEACHER", label: "Class teacher" },
  { value: "STAFF", label: "Staff" },
  { value: "OWNER", label: "Owner" },
];

export default function UsersPage() {
  const users = useApi<User[]>("/users");
  const campuses = useApi<Campus[]>("/campuses");
  const [error, setError] = useState("");
  const campusName = (id: string | null) =>
    id ? (campuses.data?.find((c) => c.id === id)?.name ?? "campus") : "all campuses";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    try {
      await api("/users", {
        method: "POST",
        body: {
          name: f.get("name"),
          email: f.get("email") || undefined,
          phone: f.get("phone") || undefined,
          password: f.get("password"),
          roles: [{ role: f.get("role"), campusId: f.get("campusId") || null }],
        },
      });
      formEl.reset();
      setError("");
      await users.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <h1 className="mb-4 text-xl font-semibold">Users and roles</h1>
        <ErrorText>{users.error}</ErrorText>
        <table className="w-full text-left text-sm">
          <thead className="opacity-60">
            <tr><th className="py-2">Name</th><th>Login</th><th>Roles</th><th>Last sign-in</th></tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id} className="border-t border-black/5 dark:border-white/10">
                <td className="py-2 font-medium">{u.name}</td>
                <td>{u.email ?? u.phone}</td>
                <td>{u.roles.map((r) => `${r.role.toLowerCase()} (${campusName(r.campusId)})`).join(", ")}</td>
                <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">Add a user</h2>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label="Name" name="name" required />
          <Field label="Email" name="email" type="email" />
          <Field label="Phone" name="phone" placeholder="03001234567" />
          <Field label="Temporary password" name="password" type="password" minLength={8} required />
          <Select label="Role" name="role" options={ROLE_OPTIONS} />
          <Select
            label="Campus"
            name="campusId"
            options={[{ value: "", label: "All campuses" }, ...(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
          />
          <ErrorText>{error}</ErrorText>
          <Button type="submit">Add user</Button>
        </form>
      </Card>
    </div>
  );
}
