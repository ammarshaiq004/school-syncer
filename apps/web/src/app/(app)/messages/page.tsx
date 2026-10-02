"use client";

import { Badge, Card, ErrorText, PageTitle, rowClass, tableClass } from "@/components/ui";
import { useApi } from "@/lib/use-api";

interface Log {
  id: string;
  channel: string;
  to: string;
  template: string;
  body: string;
  status: string;
  error: string | null;
  createdAt: string;
}

export default function MessagesPage() {
  const logs = useApi<Log[]>("/notifications?take=200");
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Message log</PageTitle>
      <ErrorText>{logs.error}</ErrorText>
      <Card>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead className="opacity-60">
              <tr><th className="py-2">When</th><th>To</th><th>Type</th><th>Message</th><th>Status</th></tr>
            </thead>
            <tbody>
              {logs.data?.map((l) => (
                <tr key={l.id} className={`${rowClass} align-top`}>
                  <td className="whitespace-nowrap py-2">{new Date(l.createdAt).toLocaleString("en-GB")}</td>
                  <td className="font-mono text-xs">{l.to}</td>
                  <td>{l.template}</td>
                  <td className="max-w-md">{l.body}{l.error && <div className="text-xs text-red-600">{l.error}</div>}</td>
                  <td><Badge tone={l.status === "SENT" ? "green" : l.status === "FAILED" ? "red" : "amber"}>{l.status.toLowerCase()}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.data?.length === 0 && <p className="py-6 text-center text-sm opacity-60">No messages sent yet.</p>}
        </div>
      </Card>
    </div>
  );
}
