"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { IdCard, Printer } from "lucide-react";
import { Alert, Button, buttonClass, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { day } from "@/lib/format";
import { useSchoolMode } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Letterhead {
  name: string;
  city: string | null;
  phone: string | null;
  logoUrl: string | null;
}

interface StudentCard {
  id: string;
  name: string;
  admissionNo: string;
  className: string | null;
  rollNo: number | null;
  dateOfBirth: string | null;
  photoUrl: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  address: string | null;
  campus: string;
  campusPhone: string | null;
  validUntil: string | null;
}

interface StaffCard {
  id: string;
  name: string;
  employeeNo: string;
  designation: string;
  department: string | null;
  phone: string | null;
  cnic: string | null;
  joinedOn: string | null;
  campus: string | null;
}

// Printers drop background colours unless told not to.
const exact: CSSProperties = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" };
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Credit-card-sized ID cards, ten to an A4 sheet. */
export default function IdCardsPage() {
  // Online schools have no campus, so no ID cards.
  if (useSchoolMode() === "ONLINE") {
    return (
      <Card>
        <EmptyState
          icon={<IdCard />}
          title="ID cards are for campus schools"
          description="Your school is set up as an online school. Change the school mode in System settings to print ID cards."
          action={
            <Link href="/certificates" className={buttonClass("secondary", "sm")}>
              Back to certificates
            </Link>
          }
        />
      </Card>
    );
  }
  return (
    <Suspense>
      <IdCards />
    </Suspense>
  );
}

function IdCards() {
  const query = useSearchParams();
  const staff = query.get("staff") === "1";
  const path = staff
    ? `/certificates/id-cards/staff${query.get("campusId") ? `?campusId=${query.get("campusId")}` : ""}`
    : `/certificates/id-cards/students?${new URLSearchParams({
        ...(query.get("sectionId") ? { sectionId: query.get("sectionId")! } : {}),
        ...(query.get("studentIds") ? { studentIds: query.get("studentIds")! } : {}),
      })}`;
  const cards = useApi<{ school: Letterhead | null; cards: (StudentCard | StaffCard)[] }>(path);
  const data = cards.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`${staff ? "Staff" : "Student"} ID cards`}
        breadcrumbs={[{ label: "Certificates and ID cards", href: "/certificates" }, { label: `${staff ? "Staff" : "Student"} ID cards` }]}
        description={
          data ? `${data.cards.length} card${data.cards.length === 1 ? "" : "s"}, ten to an A4 sheet.` : "Preparing the cards."
        }
        actions={
          <Button type="button" icon={<Printer />} onClick={() => window.print()} disabled={!data?.cards.length}>
            Print
          </Button>
        }
      />
      {data && data.cards.length > 0 && (
        <Alert tone="info" className="print:hidden">
          Print at actual size (100%), not &ldquo;fit to page&rdquo;, so each card comes out credit-card size.
        </Alert>
      )}
      {cards.error ? (
        <Card padding="none" className="print:hidden">
          <ErrorState message={cards.error} onRetry={cards.reload} />
        </Card>
      ) : !data ? (
        <div className="grid grid-cols-[repeat(auto-fill,85.6mm)] justify-center gap-[4mm] print:hidden" aria-busy>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[54mm] w-[85.6mm] rounded-[3mm]" />
          ))}
        </div>
      ) : data.cards.length === 0 ? (
        <Card padding="none" className="print:hidden">
          <EmptyState
            icon={<IdCard />}
            title="No one to make cards for"
            description={staff ? "No staff are on the payroll for this campus." : "No students are enrolled in this class."}
            action={
              <Link href="/certificates" className={buttonClass("secondary")}>
                Back to certificates
              </Link>
            }
          />
        </Card>
      ) : null}
      {data?.school && (
        <div className="grid grid-cols-[repeat(auto-fill,85.6mm)] justify-center gap-[4mm] print:grid-cols-[85.6mm_85.6mm] print:gap-x-[6mm] print:gap-y-[2mm]">
          {data.cards.map((c) =>
            staff ? (
              <StaffIdCard key={c.id} school={data.school!} card={c as StaffCard} />
            ) : (
              <StudentIdCard key={c.id} school={data.school!} card={c as StudentCard} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function CardFrame({ school, band, children, footer }: { school: Letterhead; band: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div
      className="flex h-[54mm] w-[85.6mm] break-inside-avoid flex-col overflow-hidden rounded-[3mm] border border-black/20 bg-white text-black"
      style={exact}
    >
      <div className={`flex items-center gap-2 px-3 py-1.5 text-white ${band}`} style={exact}>
        {school.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={school.logoUrl} alt="" className="h-7 w-7 rounded-full bg-white object-contain" />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[10px] font-bold text-black">
            {initials(school.name)}
          </div>
        )}
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[12px] font-bold">{school.name}</div>
          {school.city && <div className="text-[8px] opacity-90">{school.city}</div>}
        </div>
      </div>
      <div className="flex flex-1 gap-3 px-3 pt-2">{children}</div>
      <div className="px-3 pb-1.5 text-[7px] leading-tight opacity-70">{footer}</div>
    </div>
  );
}

function Photo({ url, name }: { url: string | null; name: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-[27mm] w-[22mm] shrink-0 rounded border border-black/20 object-cover" />
  ) : (
    <div className="flex h-[27mm] w-[22mm] shrink-0 items-center justify-center rounded border border-dashed border-black/30 text-lg font-semibold text-black/40">
      {initials(name)}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex gap-1 text-[9px] leading-[1.35]">
      <span className="w-14 shrink-0 opacity-60">{label}</span>
      <span className="truncate font-medium">{children}</span>
    </div>
  );
}

function StudentIdCard({ school, card }: { school: Letterhead; card: StudentCard }) {
  return (
    <CardFrame
      school={school}
      band="bg-brand"
      footer={
        <>
          {card.validUntil && <b>Valid until {day(card.validUntil)}. </b>}
          If found, please return to {school.name}, {/campus/i.test(card.campus) ? card.campus : `${card.campus} campus`}{card.campusPhone || school.phone ? `, ${card.campusPhone ?? school.phone}` : ""}.
        </>
      }
    >
      <Photo url={card.photoUrl} name={card.name} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wider text-brand">Student</div>
        <div className="mb-1 truncate text-[13px] font-bold leading-tight">{card.name}</div>
        <Row label="Class">{[card.className, card.rollNo ? `Roll ${card.rollNo}` : null].filter(Boolean).join(" · ")}</Row>
        <Row label="Admission">{card.admissionNo}</Row>
        <Row label="Born">{card.dateOfBirth ? day(card.dateOfBirth) : null}</Row>
        <Row label="Parent">{card.guardianName}</Row>
        <Row label="Phone">{card.guardianPhone}</Row>
      </div>
    </CardFrame>
  );
}

function StaffIdCard({ school, card }: { school: Letterhead; card: StaffCard }) {
  return (
    <CardFrame school={school} band="bg-slate-800" footer={<>This card belongs to {school.name}{school.phone ? `, ${school.phone}` : ""}. If found, please return it.</>}>
      <Photo url={null} name={card.name} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wider text-slate-600">Staff</div>
        <div className="truncate text-[13px] font-bold leading-tight">{card.name}</div>
        <div className="mb-1 truncate text-[10px]">{card.designation}</div>
        <Row label="Employee">{card.employeeNo}</Row>
        <Row label="Department">{card.department}</Row>
        <Row label="Campus">{card.campus}</Row>
        <Row label="Phone">{card.phone}</Row>
        <Row label="CNIC">{card.cnic}</Row>
      </div>
    </CardFrame>
  );
}
