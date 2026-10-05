import { VerifyForm } from "./verify-form";
import { Card } from "@/components/ui";
import { VerifyShell } from "@/components/verify/verify-shell";

/** Public: where the address printed on a certificate leads. */
export default function VerifyPage() {
  return (
    <VerifyShell
      title="Certificate check"
      description="Schools on SchoolSyncer print a ten-character code at the bottom of every leaving, character and enrolment certificate. Enter it to see who the school issued it to."
    >
      <Card>
        <VerifyForm label="Code on the certificate" />
      </Card>
    </VerifyShell>
  );
}
