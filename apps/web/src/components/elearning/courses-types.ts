/** Shapes returned by /elearning/courses (staff course builder). */

import type { FileLink } from "./file-upload";

export type LessonKind = "VIDEO" | "TEXT" | "LINK" | "DOCUMENT";

export interface CourseSection {
  id: string;
  name: string;
  class: { id: string; name: string; campusId: string };
}

export interface CourseSummary {
  id: string;
  sectionId: string;
  subjectId: string;
  teacherId: string | null;
  title: string;
  description: string | null;
  color: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  section: CourseSection;
  subject: { id: string; name: string; code: string | null };
  teacher: { id: string; name: string } | null;
  unitCount: number;
  lessonCount: number;
  publishedLessonCount: number;
  studentCount: number;
  avgCompletion: number;
  canManage: boolean;
}

export interface Lesson {
  id: string;
  unitId: string;
  title: string;
  kind: LessonKind;
  body: string | null;
  url: string | null;
  /** Uploaded video or document; shown instead of the link when set. */
  file: FileLink | null;
  durationMin: number | null;
  sortOrder: number;
  isPublished: boolean;
  publishedAt: string | null;
  embedUrl: string | null;
}

export interface CourseUnit {
  id: string;
  courseId: string;
  title: string;
  sortOrder: number;
  lessons: Lesson[];
}

export interface CourseDetail extends Omit<CourseSummary, "unitCount" | "lessonCount" | "publishedLessonCount" | "avgCompletion"> {
  units: CourseUnit[];
}

export interface CourseProgress {
  course: { id: string; title: string };
  units: { id: string; title: string }[];
  lessons: { id: string; title: string; kind: LessonKind; isPublished: boolean; unitId: string; unitTitle: string }[];
  publishedLessonCount: number;
  students: {
    id: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    completed: Record<string, string>;
    completedCount: number;
    percent: number;
  }[];
  avgPercent: number;
}

export const LESSON_KIND_LABEL: Record<LessonKind, string> = {
  VIDEO: "Video",
  TEXT: "Reading",
  LINK: "Link",
  DOCUMENT: "Document",
};

/** "Grade 5 A" */
export const sectionName = (s: CourseSection) => `${s.class.name} ${s.name}`;

/** Course accent: its own colour, else the first chart colour. */
export const courseColor = (c: { color: string | null }) => c.color ?? "var(--chart-1)";

/** Swaps item i with its neighbour (dir -1 up, +1 down) and returns the new id order, or null at the edge. */
export function moveId(ids: string[], index: number, dir: -1 | 1): string[] | null {
  const j = index + dir;
  if (j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}
