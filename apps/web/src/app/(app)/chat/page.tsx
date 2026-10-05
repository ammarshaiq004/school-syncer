"use client";

import { Suspense } from "react";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export default function MessagesPage() {
  return (
    <Suspense>
      <ChatWorkspace kind="staff" />
    </Suspense>
  );
}
