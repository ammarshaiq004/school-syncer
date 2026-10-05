"use client";

import { MessageSquareText, PenLine, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { AskPanel } from "@/components/assistant/ask-panel";
import type { AssistantOptions, AssistantStatus, DraftTarget } from "@/components/assistant/assistant-types";
import { DraftPanel } from "@/components/assistant/draft-panel";
import { RiskPanel } from "@/components/assistant/risk-panel";
import { Badge, Card, ErrorState, PageHeader, SkeletonRows, TabPanel, Tabs } from "@/components/ui";
import { usePersistedState } from "@/lib/persisted";
import { can, FEES, hasRole, TEACHING, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "risk" | "ask" | "drafts";

export default function AssistantPage() {
  const user = useSession();
  const status = useApi<AssistantStatus>("/assistant/status");
  const options = useApi<AssistantOptions>("/assistant/options");
  const [tab, setTab] = usePersistedState<Tab>("schoolsyncer.assistant.tab", "risk");
  const [target, setTarget] = useState<{ n: number; value: DraftTarget } | null>(null);

  const teaching = hasRole(user, TEACHING);
  const canRemark = teaching && can(user, "exams");
  const canChat = teaching && can(user, "chat");
  const canFees = hasRole(user, FEES) && can(user, "fees");

  const s = status.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI assistant"
        description="Spot students who need help, ask questions about your classes, and draft remarks and messages to parents."
        breadcrumbs={[{ label: "Overview" }, { label: "AI assistant" }]}
        meta={
          s?.ai ? (
            <Badge tone={s.usedToday >= s.dailyLimit ? "warning" : "neutral"}>
              {s.usedToday} of {s.dailyLimit} AI requests used today
            </Badge>
          ) : undefined
        }
      />
      {status.error ? (
        <Card padding="none">
          <ErrorState message={status.error} onRetry={status.reload} />
        </Card>
      ) : !s ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : (
        <Tabs
          aria-label="Assistant tools"
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          tabs={[
            { value: "risk", label: "Students at risk", icon: <TriangleAlert /> },
            { value: "ask", label: "Ask a question", icon: <MessageSquareText /> },
            { value: "drafts", label: "Remarks and messages", icon: <PenLine /> },
          ]}
        >
          <TabPanel value="risk">
            <RiskPanel
              canRemark={canRemark}
              onDraft={(t) => {
                setTarget((prev) => ({ n: (prev?.n ?? 0) + 1, value: t }));
                setTab("drafts");
              }}
            />
          </TabPanel>
          <TabPanel value="ask">
            <AskPanel status={s} onUsed={status.reload} canFees={canFees} />
          </TabPanel>
          <TabPanel value="drafts">
            <DraftPanel key={target?.n ?? 0} status={s} options={options.data} target={target?.value ?? null} onUsed={status.reload} canRemark={canRemark} canChat={canChat} />
          </TabPanel>
        </Tabs>
      )}
    </div>
  );
}
