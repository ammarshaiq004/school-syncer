import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-4">
      <h1 className="text-4xl font-bold">SchoolSyncer</h1>
      <p className="text-lg opacity-80">
        Admissions, attendance, fees, exams, staff and parent communication for
        every campus, in one modern portal.
      </p>
      <div className="flex gap-3">
        <Link href="/login" className="rounded-lg bg-brand px-4 py-2 font-medium text-white">
          Sign in
        </Link>
        <Link href="/register" className="rounded-lg border border-black/15 px-4 py-2 font-medium dark:border-white/20">
          Register your school
        </Link>
      </div>
    </main>
  );
}
