"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CircleCheck, ClipboardList, MessageCircle, Send, UserCheck } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { EnquiryFields, enquiryBody, type CampusOption } from "@/components/enquiry-fields";
import { Alert, Button, ErrorState, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";

interface Options { name: string; logoUrl: string | null; campuses: CampusOption[] }

const STEPS = [
  { icon: ClipboardList, title: "Send this short form", text: "It takes about two minutes. No documents needed yet." },
  { icon: MessageCircle, title: "The school contacts you", text: "Usually within two working days, on WhatsApp or by phone." },
  { icon: UserCheck, title: "Visit, test and admission", text: "The school will share the entry test or interview date and the fee details." },
];

function ApplyAside({ options }: { options: Options | null }) {
  return (
    <div className="relative mx-auto w-full max-w-lg text-slate-200">
      {options?.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={options.logoUrl} alt="" className="mb-6 size-14 rounded-xl bg-white object-contain p-1.5" />
      )}
      <p className="text-[13px] font-medium text-indigo-300">Admissions open</p>
      <h2 className="mt-3 text-3xl font-semibold leading-tight text-white">
        {options ? `Apply to ${options.name}` : "Apply for admission"}
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
        Tell the school about your child and how to reach you. Your details go straight to the admissions office.
      </p>
      <ol className="mt-10 grid gap-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-400/15 text-indigo-300">
              <s.icon className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium text-white">
                <span className="me-1.5 text-slate-500 tabular-nums">{i + 1}.</span>
                {s.title}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Public admission enquiry page a school can share on Facebook or WhatsApp. */
export default function ApplyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [options, setOptions] = useState<Options | null>(null);
  const [campusId, setCampusId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(() => {
    return api<Options>(`/public/${slug}/admission-options`)
      .then((o) => {
        setOptions(o);
        setCampusId(o.campuses[0]?.id ?? "");
        setLoadError("");
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await api(`/public/${slug}/enquiries`, { method: "POST", body: enquiryBody(new FormData(event.currentTarget)) });
      setError("");
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthShell
      width="md"
      eyebrow="Admission enquiry"
      title={options?.name ?? (loadError ? "Admissions" : <Skeleton className="h-8 w-64" />)}
      description={done ? undefined : "Fill in your child's details and the school will get back to you."}
      aside={<ApplyAside options={options} />}
      footer={!done && options ? "We only use these details to contact you about this admission." : undefined}
    >
      {done ? (
        <div className="flex flex-col items-start gap-4 rounded-xl border border-border bg-surface p-6 shadow-card animate-rise" role="status">
          <span className="grid size-11 place-items-center rounded-full bg-success-tint text-success">
            <CircleCheck className="size-6" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-fg">Enquiry sent</h2>
            <p className="mt-1 text-sm leading-relaxed text-fg-secondary">
              Thank you. The school has your enquiry and will contact you on WhatsApp or by phone.
            </p>
          </div>
        </div>
      ) : options ? (
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <EnquiryFields campuses={options.campuses} campusId={campusId} onCampusChange={setCampusId} />
          {error && (
            <Alert tone="danger" className="sm:col-span-full">
              {error}
            </Alert>
          )}
          <Button type="submit" loading={saving} icon={<Send />} className="w-full sm:col-span-full">
            Send enquiry
          </Button>
        </form>
      ) : loadError ? (
        <ErrorState title="Could not open this admission form" message={loadError} onRetry={() => void load()} compact />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Loading form">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
          <Skeleton className="h-9 w-full sm:col-span-full" />
        </div>
      )}
    </AuthShell>
  );
}
