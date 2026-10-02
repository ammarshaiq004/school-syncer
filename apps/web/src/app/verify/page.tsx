import { VerifyForm } from "./verify-form";
import { Card } from "@/components/ui";

/** Public: where the address printed on a certificate leads. */
export default function VerifyPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Certificate check</h1>
      <p className="text-sm opacity-70">
        Schools on SchoolSyncer print a ten-character code at the bottom of every leaving, character and enrolment certificate. Enter it to see who the school issued it to.
      </p>
      <Card>
        <VerifyForm label="Code on the certificate" />
      </Card>
    </main>
  );
}
