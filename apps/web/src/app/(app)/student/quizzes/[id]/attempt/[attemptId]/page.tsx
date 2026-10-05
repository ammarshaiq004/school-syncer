"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ListChecks, RotateCcw } from "lucide-react";
import { QuizResult } from "@/components/student-learning/quiz-result";
import { QuizTaker } from "@/components/student-learning/quiz-taker";
import { RichText } from "@/components/student-learning/rich-text";
import type { AttemptPaper, AttemptResult, AttemptView } from "@/components/student-learning/types";
import { Button, buttonClass, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/** Takes a quiz attempt (timer, autosave) or, once submitted, shows its result. */
export default function QuizAttemptPage() {
  const { id: quizId, attemptId } = useParams<{ id: string; attemptId: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, errorStatus, reload } = useApi<AttemptView>(`/student/attempts/${attemptId}`);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [retrying, setRetrying] = useState(false);
  const view: AttemptView | null = result ?? data;
  const onFinished = useCallback((r: AttemptResult) => {
    setResult(r);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  async function retry() {
    setRetrying(true);
    try {
      const paper = await api<AttemptPaper>(`/student/quizzes/${quizId}/start`, { method: "POST" });
      router.push(`/student/quizzes/${quizId}/attempt/${paper.attemptId}`);
    } catch (e) {
      toast.error("Could not start another attempt", (e as Error).message);
      setRetrying(false);
    }
  }

  const title = view?.quiz.title ?? "Quiz";
  const crumbs = [
    { label: "Quizzes", href: "/student/quizzes" },
    { label: title, href: `/student/quizzes/${quizId}` },
    { label: view?.status === "submitted" ? "Result" : "Attempt" },
  ];

  if (error && !view) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Quiz" breadcrumbs={crumbs} />
        <Card padding="none">
          {errorStatus === 404 ? (
            <EmptyState
              icon={<ListChecks />}
              title="This attempt is not available"
              description="The quiz may have been unpublished."
              action={<Link href="/student/quizzes" className={buttonClass("secondary", "sm")}>Back to quizzes</Link>}
            />
          ) : (
            <ErrorState message={error} onRetry={reload} />
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        description={view?.status === "in_progress" ? "Choose your answers. Everything saves as you go." : undefined}
        breadcrumbs={crumbs}
      />
      {!view ? (
        <Card>
          <LoadingBlock label="Loading the quiz" />
        </Card>
      ) : view.status === "in_progress" ? (
        <>
          {view.quiz.instructions && (
            <Card>
              <RichText text={view.quiz.instructions} />
            </Card>
          )}
          <QuizTaker key={view.attemptId} paper={view} onFinished={onFinished} />
        </>
      ) : (
        <QuizResult
          result={view}
          actions={
            <>
              <Link href={`/student/quizzes/${quizId}`} className={buttonClass("secondary")}>
                Back to quiz
              </Link>
              {view.canRetry && (
                <Button type="button" icon={<RotateCcw />} loading={retrying} onClick={retry}>
                  Try again
                </Button>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
