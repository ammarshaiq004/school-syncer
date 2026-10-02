export type CertificateType = "LEAVING" | "CHARACTER" | "ENROLMENT";

export const CERTIFICATE_TITLE: Record<CertificateType, string> = {
  LEAVING: "School Leaving Certificate",
  CHARACTER: "Character Certificate",
  ENROLMENT: "Enrolment Certificate",
};

export const CERTIFICATE_SHORT: Record<CertificateType, string> = {
  LEAVING: "Leaving",
  CHARACTER: "Character",
  ENROLMENT: "Enrolment",
};

export const CONDUCT = ["Excellent", "Very good", "Good", "Satisfactory"];

export interface CertificateDetails {
  studentName: string;
  guardianName: string | null;
  guardianRelation: string | null;
  gender: "MALE" | "FEMALE";
  status: string;
  admissionNo: string;
  dateOfBirth: string | null;
  dateOfBirthWords: string | null;
  admittedOn: string;
  classAdmitted: string | null;
  className: string | null;
  session: string | null;
  campus: string;
  conduct: string;
  remarks: string | null;
  leavingOn?: string;
  reason?: string | null;
  duesOwed?: number;
}

export interface Certificate {
  id: string;
  type: CertificateType;
  serialNo: string;
  verifyCode: string;
  issuedOn: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  details: CertificateDetails;
  school: { name: string; city: string | null; phone: string | null; email: string | null; logoUrl: string | null };
  campus: { name: string; address: string | null; phone: string | null };
  studentId: string;
  photoUrl: string | null;
  issuedBy: string;
}

export interface CertificateRow {
  id: string;
  type: CertificateType;
  serialNo: string;
  issuedOn: string;
  cancelled: boolean;
  student: { id: string; name: string; admissionNo: string };
  className: string | null;
  issuedBy: string;
}

/** The public page that checks a certificate, as printed on it. */
export const verifyUrl = (code: string) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/verify/${code}`;

/** "son of" / "daughter of" for certificate wording. */
export const childOf = (gender: string) => (gender === "FEMALE" ? "daughter" : "son");
export const pronoun = (gender: string) =>
  gender === "FEMALE" ? { he: "she", his: "her", He: "She", His: "Her" } : { he: "he", his: "his", He: "He", His: "His" };
