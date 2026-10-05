"use client";

import { Suspense } from "react";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export default function TeacherChatPage() {
  return (
    <Suspense>
      <ChatWorkspace kind="parent" />
    </Suspense>
  );
}
