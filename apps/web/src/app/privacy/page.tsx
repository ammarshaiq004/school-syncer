import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/kit/theme-toggle";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What SchoolSyncer collects for schools, parents and students, why, and how to have it removed.",
};

/**
 * Where privacy requests go. The App Store and Google Play listings link to
 * this page (docs/mobile-release.md); confirm the mailbox exists before
 * submitting.
 */
const CONTACT = "privacy@schoolsyncer.pk";
const UPDATED = "15 October 2026";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-fg-secondary [&_li]:ms-5 [&_li]:list-disc">{children}</div>
    </section>
  );
}

/** Public: linked from sign-in, the mobile app and both store listings. */
export default function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <Link href="/" className="rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
            <BrandLockup />
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-7 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Privacy policy</h1>
          <p className="mt-1 text-sm text-fg-muted">Last updated {UPDATED}. Applies to the SchoolSyncer website and the SchoolSyncer mobile app.</p>
        </div>

        <Section title="Who we are">
          <p>
            SchoolSyncer runs school management software. Each school that uses it decides what it records about its students, parents and staff;
            SchoolSyncer stores and processes that information for the school. Questions about the records a school keeps about you are best sent to the
            school first.
          </p>
        </Section>

        <Section title="What we collect">
          <ul>
            <li>Account details: name, phone number, email address, username and a scrambled (hashed) password.</li>
            <li>Student records the school enters: name, date of birth, class, admission details, photo, attendance, homework, marks and report cards.</li>
            <li>Parent and guardian details the school enters: name, relationship, phone number and CNIC.</li>
            <li>Fee records: vouchers, payments, receipts and concessions. Card and wallet details are entered on the payment provider&apos;s own page and never reach us.</li>
            <li>Messages sent through SchoolSyncer, such as chats with teachers and announcements.</li>
            <li>
              Technical details needed to run the service: the app version and device platform (iOS or Android), IP address and the time of each
              request, kept in server logs.
            </li>
          </ul>
          <p>The mobile app does not use advertising identifiers, does not track you across other apps or websites and does not read your contacts or location.</p>
        </Section>

        <Section title="Why we use it">
          <ul>
            <li>To let the school run admissions, attendance, exams, timetables and fees.</li>
            <li>To show parents and students their own records and let parents pay fees.</li>
            <li>To send fee vouchers, reminders, sign-in codes and announcements by WhatsApp or SMS.</li>
            <li>To keep the service secure, for example limiting sign-in attempts and asking old app versions to update.</li>
          </ul>
          <p>We do not sell personal information or use it for advertising.</p>
        </Section>

        <Section title="Who we share it with">
          <p>Only the services needed to run SchoolSyncer, each bound to use it for that purpose alone:</p>
          <ul>
            <li>Hosting and file storage providers that keep the data and uploaded files.</li>
            <li>Payment providers (such as JazzCash, Easypaisa and 1Bill) when a parent pays online.</li>
            <li>WhatsApp and SMS providers that deliver the school&apos;s messages.</li>
            <li>If the school turns on the assistant, an AI provider that processes the question and the records needed to answer it.</li>
          </ul>
          <p>We disclose information when the law requires it.</p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Records stay for as long as the school uses SchoolSyncer, or as long as the school must keep them by law (fee and exam records often need
            to be kept for years). When a school leaves, its data is deleted after any period agreed with it.
          </p>
        </Section>

        <Section title="Your choices and deleting your account">
          <p>
            Parents, students and staff can ask their school to correct or remove their records, or to close their account. You can also write to{" "}
            <a className="font-medium text-brand hover:underline" href={`mailto:${CONTACT}`}>
              {CONTACT}
            </a>{" "}
            with your school&apos;s name and your phone number; we will pass the request to the school and confirm what was deleted. Signing out of the app
            removes your sign-in from the phone.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Student accounts are created by the school, not by children themselves. Schools are responsible for having the consent of parents or
            guardians to record their children&apos;s information.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Connections are encrypted, passwords are stored hashed, sign-in attempts are limited and staff access is limited by role. No system is
            perfectly secure; if we learn of a breach affecting your information we will tell the school.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p>
            We will post changes to this policy on this page and update the date at the top. Questions:{" "}
            <a className="font-medium text-brand hover:underline" href={`mailto:${CONTACT}`}>
              {CONTACT}
            </a>
            .
          </p>
        </Section>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-fg-disabled">© {new Date().getFullYear()} SchoolSyncer</footer>
    </div>
  );
}
