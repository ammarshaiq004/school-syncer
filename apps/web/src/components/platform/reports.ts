/** GET /platform/reports */
export interface PlatformReports {
  generatedAt: string;
  mrr: number;
  students: number;
  schools: number;
  revenueByMonth: { month: string; amount: number }[];
  newSchoolsByMonth: { month: string; count: number }[];
  schoolsByStatus: Record<"TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED", number>;
  schoolsByPlan: { planCode: string; planName: string; schools: number; mrr: number }[];
  trialConversion: { converted: number; lost: number; inTrial: number; rate: number | null };
  churnRisk: {
    schoolId: string;
    name: string;
    slug: string;
    status: string;
    reason: "past_due" | "trial_ending" | "inactive" | "students_falling";
    detail: string;
  }[];
}

export const RISK_LABELS: Record<PlatformReports["churnRisk"][number]["reason"], { label: string; tone: "danger" | "warning" | "info" | "neutral" }> = {
  past_due: { label: "Past due", tone: "danger" },
  trial_ending: { label: "Trial ending", tone: "info" },
  inactive: { label: "No sign-ins", tone: "warning" },
  students_falling: { label: "Students falling", tone: "warning" },
};
