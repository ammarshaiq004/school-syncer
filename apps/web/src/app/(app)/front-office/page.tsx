"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BookUser, Cake, Mail, MessageSquareWarning, Printer, UserCheck, Users } from "lucide-react";
import { buttonClass, PageHeader, TabPanel, Tabs } from "@/components/ui";
import { Birthdays, Complaints, Contacts, Postal, ShortLeaves, Visitors } from "@/components/front-office/registers";

const TABS = [
  { value: "visitors", label: "Visitors", icon: <Users /> },
  { value: "postal", label: "Post register", icon: <Mail /> },
  { value: "short-leave", label: "Short leave", icon: <UserCheck /> },
  { value: "complaints", label: "Complaints", icon: <MessageSquareWarning /> },
  { value: "contacts", label: "Phone book", icon: <BookUser /> },
  { value: "birthdays", label: "Birthdays", icon: <Cake /> },
];

export default function FrontOfficePage() {
  return (
    <Suspense>
      <FrontOffice />
    </Suspense>
  );
}

function FrontOffice() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("tab");
  const tab = TABS.some((t) => t.value === requested) ? (requested as string) : "visitors";

  function changeTab(next: string) {
    router.replace(next === "visitors" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Front office"
        description="Visitors, post, short leave, complaints and the phone book, all in one place."
        breadcrumbs={[{ label: "Operations" }, { label: "Front office" }]}
        actions={
          <Link href="/front-office/slips" className={buttonClass("secondary", "md")}>
            <Printer className="size-4" aria-hidden />
            Student slips
          </Link>
        }
      />
      <Tabs tabs={TABS} value={tab} onValueChange={changeTab} aria-label="Front office registers">
        <TabPanel value="visitors">{tab === "visitors" && <Visitors />}</TabPanel>
        <TabPanel value="postal">{tab === "postal" && <Postal />}</TabPanel>
        <TabPanel value="short-leave">{tab === "short-leave" && <ShortLeaves />}</TabPanel>
        <TabPanel value="complaints">{tab === "complaints" && <Complaints />}</TabPanel>
        <TabPanel value="contacts">{tab === "contacts" && <Contacts />}</TabPanel>
        <TabPanel value="birthdays">{tab === "birthdays" && <Birthdays />}</TabPanel>
      </Tabs>
    </div>
  );
}
