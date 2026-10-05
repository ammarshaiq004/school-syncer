"use client";

import { Alert, useToast } from "@/components/ui";
import { platformApi } from "@/lib/api";
import { ReasonDialog } from "./reason-dialog";

export type LifecycleAction = "suspend" | "reactivate" | "cancel";

const COPY: Record<LifecycleAction, { title: string; description: string; confirm: string; done: string; destructive: boolean; effect: string }> = {
  suspend: {
    title: "Suspend",
    description: "Nobody at the school can use SchoolSyncer until it is reactivated. Their data is kept.",
    confirm: "Suspend school",
    done: "School suspended",
    destructive: true,
    effect: "Staff and parents see a message that the account is suspended and to contact SchoolSyncer.",
  },
  reactivate: {
    title: "Reactivate",
    description: "The school gets full access again on its current plan, and billing resumes.",
    confirm: "Reactivate school",
    done: "School reactivated",
    destructive: false,
    effect: "The subscription moves to Active straight away.",
  },
  cancel: {
    title: "Close",
    description: "Closes the school's account for good. Nobody there can use SchoolSyncer unless it is reactivated.",
    confirm: "Close school",
    done: "School closed",
    destructive: true,
    effect: "Data is kept and no new monthly bills are made for a closed school.",
  },
};

/** Suspend, reactivate or close a school, with a reason recorded in the platform audit log. */
export function LifecycleDialog({
  action,
  schoolId,
  schoolName,
  onOpenChange,
  onDone,
}: {
  action: LifecycleAction | null;
  schoolId: string;
  schoolName: string;
  onOpenChange: (open: boolean) => void;
  onDone: () => Promise<void> | void;
}) {
  const toast = useToast();
  const copy = COPY[action ?? "suspend"];

  return (
    <ReasonDialog
      open={!!action}
      onOpenChange={onOpenChange}
      title={`${copy.title} ${schoolName}?`}
      description={copy.description}
      confirmLabel={copy.confirm}
      destructive={copy.destructive}
      placeholder={action === "reactivate" ? "Paid the overdue September bill by bank transfer" : "Two bills unpaid after reminders on 5 and 12 September"}
      onSubmit={async (reason) => {
        await platformApi(`/schools/${schoolId}/${action}`, { method: "POST", body: { reason } });
        toast.success(copy.done, schoolName);
        await onDone();
      }}
    >
      <Alert tone={copy.destructive ? "warning" : "info"} icon={null}>
        {copy.effect}
      </Alert>
    </ReasonDialog>
  );
}
