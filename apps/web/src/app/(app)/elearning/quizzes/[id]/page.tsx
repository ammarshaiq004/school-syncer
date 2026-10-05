"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ChartColumn, ChevronDown, ChevronUp, CircleCheck, Ellipsis, ListChecks, Lock, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownItem,
  DropdownMenu,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Switch,
  TabPanel,
  Tabs,
  Tooltip,
  useToast,
} from "@/components/ui";
import { QuestionDialog, type QuestionTarget } from "@/components/elearning/assess-question-editor";
import { QuizResultsPanel } from "@/components/elearning/assess-quiz-results";
import { QuizSettingsPanel } from "@/components/elearning/assess-quiz-settings";
import { QUESTION_KIND_LABEL, WINDOW_LABEL, whenText, type Question, type QuizDetail } from "@/components/elearning/assess-types";
import { moveId, sectionName } from "@/components/elearning/courses-types";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

const TABS = ["questions", "settings", "results"] as const;
type Tab = (typeof TABS)[number];

export default function QuizBuilderPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={8} />}>
      <QuizBuilder />
    </Suspense>
  );
}

type Removing = { kind: "quiz" } | { kind: "question"; question: Question; index: number };

function QuizBuilder() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const { data: quiz, error, errorStatus, reload } = useApi<QuizDetail>(`/elearning/quizzes/${id}`);
  const fromUrl = params.get("tab");
  const tab: Tab = TABS.includes(fromUrl as Tab) ? (fromUrl as Tab) : "questions";
  const [editing, setEditing] = useState<QuestionTarget | null>(null);
  const [removing, setRemoving] = useState<Removing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const setTab = (t: string) => router.replace(t === "questions" ? pathname : `${pathname}?tab=${t}`, { scroll: false });

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Quiz" breadcrumbs={[{ label: "Quizzes", href: "/elearning/quizzes" }, { label: "Quiz" }]} />
        <ErrorState
          title={errorStatus === 404 ? "Quiz not found" : undefined}
          message={errorStatus === 404 ? "It may have been deleted, or it belongs to a section you do not teach." : error}
          onRetry={errorStatus === 404 ? undefined : reload}
        />
      </div>
    );
  }
  if (!quiz) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Loading quiz" breadcrumbs={[{ label: "Quizzes", href: "/elearning/quizzes" }, { label: "Quiz" }]} />
        <SkeletonRows rows={8} />
      </div>
    );
  }

  const manage = quiz.canManage;
  const locked = quiz.locked;
  const canPublish = quiz.questionCount > 0 && quiz.totalPoints > 0;

  async function run(key: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      await reload();
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const move = (index: number, dir: -1 | 1) => {
    const ids = moveId(
      quiz.questions.map((q) => q.id),
      index,
      dir,
    );
    if (ids) void run(`move-${quiz.questions[index].id}`, () => api(`/elearning/quizzes/${quiz.id}/questions/order`, { method: "PUT", body: { ids } }));
  };

  async function confirmRemove() {
    if (!removing || !quiz) return;
    if (removing.kind === "quiz") {
      setBusy("remove");
      try {
        await api(`/elearning/quizzes/${quiz.id}`, { method: "DELETE" });
        toast.success("Quiz deleted", quiz.title);
        router.push("/elearning/quizzes");
      } catch (e) {
        toast.error("Could not delete quiz", (e as Error).message);
        setBusy(null);
      }
      return;
    }
    await run("remove", () => api(`/elearning/questions/${removing.question.id}`, { method: "DELETE" }), "Question deleted");
    setRemoving(null);
  }

  const windowText = [
    quiz.opensAt ? `Opens ${whenText(quiz.opensAt)}` : "Opens when published",
    quiz.closesAt ? `closes ${whenText(quiz.closesAt)}` : "no closing time",
  ].join(", ");

  const publishSwitch = (
    <Switch
      checked={quiz.isPublished}
      disabled={busy === "publish" || (!quiz.isPublished && !canPublish)}
      onCheckedChange={(on) =>
        run("publish", () => api(`/elearning/quizzes/${quiz.id}/publish`, { method: "PUT", body: { isPublished: on } }), on ? "Quiz published" : "Quiz moved to draft")
      }
      label="Published"
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={quiz.title}
        description={`${sectionName(quiz.section)} · ${quiz.subject.name} · ${quiz.questionCount} ${quiz.questionCount === 1 ? "question" : "questions"}, ${quiz.totalPoints} ${quiz.totalPoints === 1 ? "point" : "points"}${quiz.timeLimitMin ? ` · ${quiz.timeLimitMin} min` : ""}`}
        breadcrumbs={[{ label: "E-school", href: "/elearning" }, { label: "Quizzes", href: "/elearning/quizzes" }, { label: quiz.title }]}
        meta={
          quiz.isPublished ? (
            <StatusPill status={quiz.window} tone={quiz.window === "open" ? "success" : quiz.window === "upcoming" ? "info" : "neutral"} label={WINDOW_LABEL[quiz.window]} />
          ) : (
            <StatusPill status="DRAFT" />
          )
        }
        actions={
          manage && (
            <>
              {!quiz.isPublished && !canPublish ? (
                <Tooltip content="Add at least one question worth points first">
                  <span tabIndex={0} className="rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
                    {publishSwitch}
                  </span>
                </Tooltip>
              ) : (
                publishSwitch
              )}
              <DropdownMenu trigger={<IconButton variant="secondary" aria-label="More quiz actions"><Ellipsis /></IconButton>}>
                <DropdownItem icon={<Trash2 />} danger onSelect={() => setRemoving({ kind: "quiz" })}>
                  Delete quiz
                </DropdownItem>
              </DropdownMenu>
            </>
          )
        }
      />

      <Tabs
        aria-label="Quiz sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "questions", label: "Questions", icon: <ListChecks />, count: quiz.questionCount },
          { value: "settings", label: "Settings", icon: <Settings2 /> },
          { value: "results", label: "Results", icon: <ChartColumn />, count: quiz.needsReviewCount || undefined },
        ]}
      >
        <TabPanel value="questions">
          <div className="flex flex-col gap-4">
            {locked && (
              <Alert tone="warning" icon={<Lock />} title="Questions are locked">
                Students have attempted this quiz, so you can fix wording but not answers, points or the question list. This keeps earlier scores fair.
              </Alert>
            )}
            {!quiz.isPublished && manage && quiz.questionCount > 0 && (
              <Alert tone="info" title="This quiz is a draft">
                Students cannot see it yet. Turn on Published when the questions are ready. {windowText}.
              </Alert>
            )}
            {quiz.questions.length === 0 ? (
              <Card padding="none">
                <EmptyState
                  icon={<ListChecks />}
                  title="No questions yet"
                  description="Add single choice, multiple choice, true or false and short answer questions. Choice questions are marked automatically."
                  action={
                    manage && (
                      <Button icon={<Plus />} onClick={() => setEditing({ quizId: quiz.id, locked })}>
                        Add question
                      </Button>
                    )
                  }
                />
              </Card>
            ) : (
              <ol className="flex flex-col gap-3">
                {quiz.questions.map((q, i) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    index={i}
                    count={quiz.questions.length}
                    manage={manage}
                    locked={locked}
                    busy={!!busy}
                    onMove={(dir) => move(i, dir)}
                    onEdit={() => setEditing({ quizId: quiz.id, question: q, locked })}
                    onDelete={() => setRemoving({ kind: "question", question: q, index: i })}
                  />
                ))}
              </ol>
            )}
            {manage && !locked && quiz.questions.length > 0 && (
              <Button variant="secondary" icon={<Plus />} className="w-fit" onClick={() => setEditing({ quizId: quiz.id, locked })}>
                Add question
              </Button>
            )}
          </div>
        </TabPanel>
        <TabPanel value="settings">{tab === "settings" && <QuizSettingsPanel key={quiz.updatedAt} quiz={quiz} onSaved={reload} />}</TabPanel>
        <TabPanel value="results">{tab === "results" && <QuizResultsPanel quizId={quiz.id} onChanged={reload} />}</TabPanel>
      </Tabs>

      <QuestionDialog target={editing} onClose={() => setEditing(null)} onSaved={reload} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        loading={busy === "remove"}
        title={removing?.kind === "quiz" ? "Delete this quiz?" : `Delete question ${removing?.kind === "question" ? removing.index + 1 : ""}?`}
        description={
          removing?.kind === "quiz"
            ? quiz.attemptCount
              ? `All questions and ${quiz.attemptCount} student attempts are deleted. This cannot be undone.`
              : "All questions are deleted. This cannot be undone."
            : "The question and its answer key are removed."
        }
        confirmLabel="Delete"
        onConfirm={confirmRemove}
      />
    </div>
  );
}

function QuestionCard({
  question: q,
  index,
  count,
  manage,
  locked,
  busy,
  onMove,
  onEdit,
  onDelete,
}: {
  question: Question;
  index: number;
  count: number;
  manage: boolean;
  locked: boolean;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const keys = q.correct.filter((c): c is number => typeof c === "number");
  const n = index + 1;
  return (
    <li>
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-muted tabular-nums">Question {n}</span>
          <Badge tone="neutral">{QUESTION_KIND_LABEL[q.kind]}</Badge>
          <Badge tone="primary">
            {q.points} {q.points === 1 ? "point" : "points"}
          </Badge>
          <span className="flex-1" />
          {manage && (
            <div className="flex items-center gap-1">
              {!locked && (
                <>
                  <IconButton size="sm" aria-label={`Move question ${n} up`} disabled={index === 0 || busy} onClick={() => onMove(-1)}>
                    <ChevronUp />
                  </IconButton>
                  <IconButton size="sm" aria-label={`Move question ${n} down`} disabled={index === count - 1 || busy} onClick={() => onMove(1)}>
                    <ChevronDown />
                  </IconButton>
                </>
              )}
              <IconButton size="sm" aria-label={`Edit question ${n}`} onClick={onEdit}>
                <Pencil />
              </IconButton>
              {!locked && (
                <IconButton size="sm" aria-label={`Delete question ${n}`} onClick={onDelete}>
                  <Trash2 />
                </IconButton>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="whitespace-pre-wrap break-words text-sm font-medium text-fg">{q.prompt}</p>
          {q.kind === "SHORT" ? (
            <p className="text-[13px] text-fg-secondary">
              <span className="text-fg-muted">Accepted answers: </span>
              {q.correct.map(String).join(", ")}
            </p>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {q.options.map((opt, oi) => {
                const right = keys.includes(oi);
                return (
                  <li key={oi} className={right ? "flex items-center gap-2 rounded-md bg-success-tint px-2.5 py-1.5 text-sm text-success-text" : "flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-sm text-fg-secondary"}>
                    <span className="w-4 shrink-0 text-xs font-semibold" aria-hidden>
                      {String.fromCharCode(65 + oi)}
                    </span>
                    <span className="flex-1">{opt}</span>
                    {right && (
                      <>
                        <CircleCheck className="size-4 shrink-0" aria-hidden />
                        <span className="sr-only">(correct)</span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </li>
  );
}
