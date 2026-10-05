"use client";

import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Alert, Badge, Button, Card, EmptyState, IconButton, Spinner, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { AnswerText } from "./answer-text";
import type { AskResponse, AssistantStatus } from "./assistant-types";

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  failed?: boolean;
}

const SUGGESTIONS = [
  "Which students were absent most this month?",
  "How did my classes do in the last exam?",
  "Which subjects have the lowest average?",
  "Who is at risk and why?",
];

const FEE_SUGGESTION = "How much fee is still outstanding this month?";

/** Plain-language questions about school data (SCHOOL-105). */
export function AskPanel({ status, onUsed, canFees }: { status: AssistantStatus; onUsed: () => void; canFees: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns, busy]);

  const atLimit = status.usedToday >= status.dailyLimit;

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history = turns.filter((t) => !t.failed).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: q }]);
    setQuestion("");
    setBusy(true);
    try {
      const res = await api<AskResponse>("/assistant/ask", { method: "POST", body: { question: q, history: history.slice(-20) } });
      setTurns((t) => [...t, { role: "assistant", content: res.answer, sources: res.sources }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", content: (e as Error).message, failed: true }]);
    } finally {
      setBusy(false);
      onUsed();
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(question);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void ask(question);
    }
  }

  if (!status.ai) {
    return (
      <Card>
        <EmptyState
          icon={<Sparkles />}
          title="Questions are not switched on yet"
          description="Asking in plain language needs SchoolSyncer's AI service, which is not set up on this server. The at-risk list and template drafts work without it."
        />
      </Card>
    );
  }

  const suggestions = canFees ? [...SUGGESTIONS, FEE_SUGGESTION] : SUGGESTIONS;

  return (
    <Card padding="none" className="flex min-h-[28rem] flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5" aria-live="polite">
        {!turns.length && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-fg-muted">
              Ask about attendance, results, fees or a student. Answers only use the classes and records your role can see.
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Button key={s} type="button" variant="secondary" size="sm" onClick={() => void ask(s)} disabled={atLimit}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ms-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-fg" dir="auto">
              {t.content}
            </div>
          ) : t.failed ? (
            <Alert key={i} tone="danger">
              {t.content}
            </Alert>
          ) : (
            <div key={i} className="max-w-[95%] rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-3 text-sm">
              <AnswerText text={t.content} />
              {!!t.sources?.length && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                  Looked at
                  {t.sources.map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Spinner /> Looking it up…
          </div>
        )}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="flex items-end gap-2 border-t border-border p-3">
        <Textarea
          aria-label="Your question"
          rows={2}
          value={question}
          maxLength={2000}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={atLimit ? "Daily limit reached. It resets at midnight." : "Ask a question… (Enter to send, Shift+Enter for a new line)"}
          disabled={atLimit}
          className="flex-1 resize-none"
          dir="auto"
        />
        {!!turns.length && (
          <IconButton aria-label="New conversation" onClick={() => setTurns([])} disabled={busy}>
            <RotateCcw />
          </IconButton>
        )}
        <IconButton type="submit" variant="primary" aria-label="Send" loading={busy} disabled={!question.trim() || atLimit}>
          <ArrowUp />
        </IconButton>
      </form>
    </Card>
  );
}
