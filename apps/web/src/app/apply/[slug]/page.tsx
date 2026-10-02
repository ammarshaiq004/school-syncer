"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { EnquiryFields, enquiryBody, type CampusOption } from "@/components/enquiry-fields";
import { Button, Card, ErrorText } from "@/components/ui";
import { api } from "@/lib/api";

interface Options { name: string; logoUrl: string | null; campuses: CampusOption[] }

/** Public admission enquiry page a school can share on Facebook or WhatsApp. */
export default function ApplyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [options, setOptions] = useState<Options | null>(null);
  const [campusId, setCampusId] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<Options>(`/public/${slug}/admission-options`)
      .then((o) => {
        setOptions(o);
        setCampusId(o.campuses[0]?.id ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api(`/public/${slug}/enquiries`, { method: "POST", body: enquiryBody(new FormData(event.currentTarget)) });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <Card>
        <h1 className="text-2xl font-semibold">{options?.name ?? "Admissions"}</h1>
        <p className="mb-6 text-sm opacity-70">Admission enquiry</p>
        {done ? (
          <p>Thank you. The school has your enquiry and will contact you on WhatsApp or by phone.</p>
        ) : options ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <EnquiryFields campuses={options.campuses} campusId={campusId} onCampusChange={setCampusId} />
            <ErrorText>{error}</ErrorText>
            <Button type="submit">Send enquiry</Button>
          </form>
        ) : (
          <ErrorText>{error}</ErrorText>
        )}
      </Card>
    </main>
  );
}
