/** Shapes returned by /assistant (apps/api/src/assistant). */

export interface AssistantStatus {
  /** False when the server has no Claude API key: questions are off, drafts use templates. */
  ai: boolean;
  model: string | null;
  usedToday: number;
  dailyLimit: number;
}

export interface AssistantSection {
  sectionId: string;
  name: string;
  classTeacher: string | null;
  students: number;
}

export interface AssistantOptions {
  sections: AssistantSection[];
  exams: { id: string; name: string }[];
}

export interface StudentHit {
  studentId: string;
  name: string;
  admissionNo: string;
  class: string | null;
}

export type RiskLevel = "high" | "medium";

export interface RiskFlag {
  area: "attendance" | "results" | "fees";
  level: RiskLevel;
  reason: string;
}

export interface AtRiskStudent {
  studentId: string;
  name: string;
  admissionNo: string;
  sectionId: string;
  section: string;
  level: RiskLevel;
  flags: RiskFlag[];
}

export interface AtRiskResponse {
  sections: AssistantSection[];
  checked: number;
  areas: { attendance: boolean; results: boolean; fees: boolean };
  students: AtRiskStudent[];
  truncated: boolean;
}

export type DraftKind = "report_remark" | "parent_message";

export interface DraftResponse {
  text: string;
  source: "ai" | "template";
  examId: string | null;
}

export interface AskResponse {
  answer: string;
  sources: string[];
}

/** A student picked on the at-risk tab, handed to the drafts tab. */
export interface DraftTarget {
  student: StudentHit;
  kind: DraftKind;
  notes?: string;
}
