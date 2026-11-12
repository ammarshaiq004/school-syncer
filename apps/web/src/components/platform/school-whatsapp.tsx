"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader, ErrorState, Skeleton, useToast } from "@/components/ui";
import { ReasonDialog } from "@/components/platform/reason-dialog";
import { platformApi } from "@/lib/api";
import { usePlatformApi } from "@/lib/use-api";
import { formatWhatsAppNumber, LINK_STATE_LABEL, type LinkView } from "@/lib/whatsapp-link";

/**
 * The number a school linked by QR (Settings > Messaging) and an Unlink with a
 * recorded reason. Switching linking on for a school is the "WhatsApp by QR
 * link" module above.
 */
export function SchoolWhatsApp({ schoolId, canEdit, featureOn }: { schoolId: string; canEdit: boolean; featureOn: boolean }) {
  const toast = useToast();
  const link = usePlatformApi<LinkView>(`/schools/${schoolId}/whatsapp`);
  const [asking, setAsking] = useState(false);
  const data = link.data;

  async function unlink(reason: string) {
    await platformApi(`/schools/${schoolId}/whatsapp/unlink`, { method: "POST", body: { reason } });
    toast.success("WhatsApp unlinked for this school");
    await link.reload();
  }

  return (
    <Card className="mt-6">
      <CardHeader
        title="WhatsApp number (QR link)"
        description={
          featureOn
            ? "The school links its own number in Settings > Messaging. You can see it and unlink it here."
            : "Off for this school. Switch on the \"WhatsApp by QR link\" module above to let it link a number."
        }
      />
      {link.error && !data ? (
        <ErrorState message={link.error} onRetry={link.reload} />
      ) : !data ? (
        <Skeleton className="h-10 w-full" />
      ) : !data.serverReady ? (
        <p className="text-sm text-fg-muted">WhatsApp linking is not set up on this server (EVOLUTION_API_URL and EVOLUTION_API_KEY).</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={data.state === "CONNECTED" ? "success" : "neutral"}>{LINK_STATE_LABEL[data.state]}</Badge>
            {data.number && <span className="font-medium tabular-nums">{formatWhatsAppNumber(data.number)}</span>}
            {data.profileName && <span className="text-xs text-fg-muted">{data.profileName}</span>}
          </div>
          {canEdit && data.state !== "NOT_LINKED" && (
            <Button type="button" variant="secondary" onClick={() => setAsking(true)}>
              Unlink
            </Button>
          )}
        </div>
      )}
      <ReasonDialog
        open={asking}
        onOpenChange={setAsking}
        title="Unlink this school's WhatsApp"
        description="Messages stop going from the school's number until it links one again. The school sees this in its audit log."
        confirmLabel="Unlink"
        destructive
        onSubmit={unlink}
      />
    </Card>
  );
}
