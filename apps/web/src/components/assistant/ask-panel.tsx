"use client";

import { ArrowUp, ArrowUpRight, Mic, RotateCcw, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Alert, Badge, Card, EmptyState, IconButton } from "@/components/ui";
import { api } from "@/lib/api";
import { aonPose, type AonPose } from "@/lib/aon";
import { cn } from "@/lib/cn";
import { useVoice } from "@/lib/use-voice";
import { AnswerText } from "./answer-text";
import { AonMark, AonMascot } from "./aon-mascot";
import type { AonTurn, AskResponse, AssistantStatus } from "./assistant-types";

const SUGGESTIONS = [
  "Which students were absent most this month?",
  "How did my classes do in the last exam?",
  "Which subjects have the lowest average?",
  "Who is at risk and why?",
];

const LEADER_SUGGESTIONS = [
  "Which students may withdraw soon, and why?",
  "What changed in the last 90 days?",
  "Which classes need attention this month?",
];

const FEE_SUGGESTION = "How much fee is still outstanding this month?";

/** One bubble. The newest answer gets Hudhud celebrating beside it; older ones keep his small face. */
function Bubble({ turn, celebrate }: { turn: AonTurn; celebrate: boolean }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end motion-safe:animate-rise">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-primary px-4 py-2.5 text-sm text-primary-fg" dir="auto">
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-end justify-start gap-2 motion-safe:animate-rise">
      {celebrate ? (
        <AonMascot pose="success" className="-mb-1 -ms-1 size-16 shrink-0" />
      ) : (
        <AonMark className="mb-1 size-7 shrink-0" pose={turn.failed ? "sleeping" : "idle"} />
      )}
      {turn.failed ? (
        <Alert tone="danger" className="max-w-[85%]">
          {turn.content}
        </Alert>
      ) : (
        <div className="max-w-[88%] rounded-3xl rounded-bl-lg bg-surface-2 px-4 py-2.5 text-sm">
          <AnswerText text={turn.content} />
          {!!turn.sources?.length && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
              Looked at
              {turn.sources.map((s) => (
                <Badge key={s}>{s}</Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Plain-language questions about school data (SCHOOL-105), in the ShopSyncer Aon chat style: Hudhud on the welcome
 * screen, beside the answer and while a question runs, a voice button, and a conversation that survives closing the
 * panel when the parent holds `turns`.
 */
export function AskPanel({
  status,
  onUsed,
  canFees,
  leader,
  compact,
  turns: heldTurns,
  onTurns,
  active = true,
  onPose,
  pendingQuestion,
  onPendingTaken,
}: {
  status: AssistantStatus;
  onUsed: () => void;
  canFees: boolean;
  /** School leaders get the director's preset questions. */
  leader?: boolean;
  /** Inside the Aon side panel: fills the panel instead of sitting in a card. */
  compact?: boolean;
  /** The conversation, when the parent keeps it (the side panel); otherwise the panel keeps its own. */
  turns?: AonTurn[];
  onTurns?: (update: (prev: AonTurn[]) => AonTurn[]) => void;
  /** The panel is on screen; closing it stops the microphone and sends Hudhud to sleep. */
  active?: boolean;
  /** Told what Hudhud is doing, so the header and the corner bird can show it too. */
  onPose?: (pose: AonPose) => void;
  /** A question another screen asked Aon to answer; sent once the panel can, then cleared with onPendingTaken. */
  pendingQuestion?: string | null;
  onPendingTaken?: () => void;
}) {
  const [ownTurns, setOwnTurns] = useState<AonTurn[]>([]);
  const turns = heldTurns ?? ownTurns;
  const setTurns = onTurns ?? ((u: (p: AonTurn[]) => AonTurn[]) => setOwnTurns(u));
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [drowsy, setDrowsy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const spoken = useRef("");
  const voice = useVoice();

  const monthDone = status.aon.monthUsed >= status.aon.monthLimit;
  const atLimit = status.usedToday >= status.dailyLimit || monthDone;
  const off = !status.aon.enabled || !status.ai;

  useEffect(() => {
    // The welcome screen stays at the top; only a conversation follows its newest message.
    if (!turns.length && !busy) return;
    end.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [turns, busy]);

  // After 3 seconds Hudhud goes from thinking to searching, and the line under him changes with him.
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const t = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(t);
  }, [busy]);

  useEffect(() => {
    if (!celebrating) return;
    const t = window.setTimeout(() => setCelebrating(false), 2400);
    return () => window.clearTimeout(t);
  }, [celebrating]);

  useEffect(() => {
    setDrowsy(false);
    if (!active) return;
    const t = window.setTimeout(() => setDrowsy(true), 90_000);
    return () => window.clearTimeout(t);
  }, [active, question, busy, turns.length]);

  const pose = aonPose({ active, blocked: atLimit || off, celebrating, pending: busy, slow, listening: voice.listening || question.trim() !== "", drowsy });
  useEffect(() => onPose?.(pose), [pose, onPose]);

  // The words you speak land in the box to check; they are never sent on their own.
  useEffect(() => {
    if (voice.transcript) setQuestion((spoken.current + voice.transcript).slice(0, 2000));
  }, [voice.transcript]);
  useEffect(() => {
    if (!active && voice.listening) voice.toggle();
  }, [active, voice]);

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [question]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy || atLimit || off) return;
    if (voice.listening) voice.toggle();
    const history = turns.filter((t) => !t.failed).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: q }]);
    setQuestion("");
    setBusy(true);
    try {
      const res = await api<AskResponse>("/assistant/ask", { method: "POST", body: { question: q, history: history.slice(-20) } });
      setTurns((t) => [...t, { role: "assistant", content: res.answer, sources: res.sources }]);
      setCelebrating(true);
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", content: (e as Error).message, failed: true }]);
    } finally {
      setBusy(false);
      onUsed();
    }
  }

  // "Ask Aon" from another screen hands over a question; send it as soon as the panel can.
  useEffect(() => {
    if (!pendingQuestion || !active || busy || atLimit || off) return;
    onPendingTaken?.();
    void ask(pendingQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ask is re-created each render; the pending text drives this
  }, [pendingQuestion, active, busy, atLimit, off]);

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

  function toggleVoice() {
    if (!voice.listening) spoken.current = question.trim() ? `${question.trim()} ` : "";
    voice.toggle();
  }

  if (!status.aon.enabled) {
    return (
      <Card>
        <EmptyState
          icon={<Sparkles />}
          title="Aon is switched off for your school"
          description={status.aon.canManage ? "You can switch it on again in Settings, under Aon." : "The school owner can switch it on in Settings."}
        />
      </Card>
    );
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

  const suggestions = [...(leader ? LEADER_SUGGESTIONS : []), ...SUGGESTIONS, ...(canFees ? [FEE_SUGGESTION] : [])];
  const last = turns.length - 1;

  return (
    <Card padding="none" className={compact ? "flex h-full min-h-0 flex-col border-0 shadow-none" : "flex min-h-[28rem] flex-col"}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5" aria-live="polite">
        {!turns.length && (
          <div className="flex min-h-full flex-col justify-center gap-4 pb-4">
            <AonMascot pose={pose} className="-mb-2 -ms-3 size-32 shrink-0 sm:size-40" />
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold tracking-tight">Hi, I&rsquo;m Aon.</h3>
              <p className="text-sm leading-relaxed text-fg-muted">
                Ask me about attendance, results, fees or a student. I only show what your role may see. I read and explain; I never change anything.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={atLimit}
                  onClick={() => void ask(s)}
                  className="group flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-start text-sm transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50"
                >
                  {s}
                  <ArrowUpRight className="size-4 shrink-0 text-fg-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:-scale-x-100" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <Bubble key={i} turn={t} celebrate={celebrating && i === last && t.role === "assistant" && !t.failed} />
        ))}
        {busy && (
          <div className="flex items-end gap-2" role="status" aria-label="Aon is thinking">
            <AonMascot pose={pose} className="-mb-1 size-16 shrink-0" />
            <p className="mb-3 rounded-3xl rounded-bl-lg bg-surface-2 px-4 py-2.5 text-sm text-fg-muted motion-safe:animate-pulse">
              {slow ? "Looking through your school data…" : "Thinking…"}
            </p>
          </div>
        )}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="px-3 pb-1 pt-1">
        <div className="flex items-end gap-1.5 rounded-3xl border border-border bg-bg py-1.5 ps-4 pe-1.5 transition-shadow focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
          <label htmlFor="aon-question" className="sr-only">
            Your question
          </label>
          <textarea
            id="aon-question"
            ref={field}
            rows={1}
            value={question}
            maxLength={2000}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={atLimit}
            placeholder={monthDone ? "Your school's AI allowance for this month is used up." : atLimit ? "Daily limit reached. It resets at midnight." : voice.listening ? "Listening…" : "Ask Aon…"}
            className="max-h-36 min-h-9 flex-1 resize-none self-center bg-transparent py-1.5 text-base placeholder:text-fg-muted focus-visible:outline-none disabled:opacity-50 sm:text-sm"
            dir="auto"
          />
          {!!turns.length && (
            <IconButton type="button" aria-label="New conversation" disabled={busy} onClick={() => setTurns(() => [])}>
              <RotateCcw />
            </IconButton>
          )}
          {voice.supported && (
            <IconButton
              type="button"
              aria-label={voice.listening ? "Stop listening" : "Speak your question"}
              aria-pressed={voice.listening}
              disabled={atLimit}
              onClick={toggleVoice}
              className={cn(voice.listening && "bg-danger-tint text-danger-text motion-safe:animate-pulse")}
            >
              {voice.listening ? <Square className="fill-current" /> : <Mic />}
            </IconButton>
          )}
          <IconButton type="submit" variant="primary" aria-label="Send" loading={busy} disabled={!question.trim() || atLimit}>
            <ArrowUp />
          </IconButton>
        </div>
      </form>
      <p className="px-5 pb-3 pt-1.5 text-[11px] leading-snug text-fg-muted">
        <AonMark className="me-1 inline-grid size-3.5 align-[-2px]" />
        Your question and the school data needed to answer it are sent to an AI service.
      </p>
    </Card>
  );
}
