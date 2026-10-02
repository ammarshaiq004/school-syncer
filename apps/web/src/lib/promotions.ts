export type Decision = "PROMOTE" | "REPEAT" | "LEAVE" | "GRADUATE";

export const DECISION_LABEL: Record<Decision, string> = {
  PROMOTE: "Moves up",
  REPEAT: "Stays back",
  LEAVE: "Leaving",
  GRADUATE: "Finished school",
};

export interface Overview {
  current: { id: string; name: string; endsOn: string } | null;
  next: { id: string; name: string; startsOn: string; sections: number } | null;
  decisions?: Partial<Record<Decision, number>>;
  sections: { id: string; name: string; campus: string; students: number; decided: number }[];
}

export interface SectionPlan {
  section: { id: string; name: string; campus: string };
  exam: { id: string; name: string } | null;
  nextYear: string;
  targets: { id: string; classId: string; name: string; sameClass: boolean }[];
  repeatSectionId: string | null;
  topClass: boolean;
  students: {
    id: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    result: { percent: number; passed: boolean; position: number } | null;
    decision: Decision;
    toSectionId: string | null;
    saved: boolean;
  }[];
}
