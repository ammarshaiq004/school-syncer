"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, CameraOff, ScanLine, Sunset } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { META_BY_STATUS, type AttendanceStatus } from "./status";

interface ScanResult {
  kind: "student" | "staff";
  name: string;
  detail: string | null;
  result: "marked" | "already";
  status: AttendanceStatus;
}
interface LogEntry {
  id: number;
  code: string;
  result?: ScanResult;
  error?: string;
}

// Chrome and Android browsers can read QR codes from the camera; elsewhere a USB scanner or typing still works.
interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
const createDetector = (): Detector | null => {
  const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  return Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
};

/** "Scan" tab: mark students and staff present from the QR on their ID card. */
export function ScanTab() {
  const user = useSession();
  const toast = useToast();
  const isAdmin = hasRole(user, SETUP);
  const school = useApi<{ attendanceLateAfter: string }>(isAdmin ? "/school" : null);
  const [code, setCode] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [lateAfter, setLateAfter] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const recent = useRef(new Map<string, number>());

  const submit = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const id = ++seq.current;
    try {
      const result = await api<ScanResult>("/attendance/scan", { method: "POST", body: { code: value } });
      setLog((l) => [{ id, code: value, result }, ...l].slice(0, 30));
    } catch (e) {
      setLog((l) => [{ id, code: value, error: (e as Error).message }, ...l].slice(0, 30));
    }
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await submit(code);
    setCode("");
    setBusy(false);
    inputRef.current?.focus();
  }

  // Camera: look for a QR code a few times a second; ignore the same card for 5 seconds so holding it up scans once.
  useEffect(() => {
    if (!cameraOn) return;
    const detector = createDetector();
    if (!detector) {
      setCameraError("This browser cannot read QR codes from the camera. Use a USB scanner or type the number.");
      setCameraOn(false);
      return;
    }
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        void video.play();
        timer = setInterval(async () => {
          const found = await detector.detect(video).catch(() => []);
          const now = Date.now();
          for (const f of found) {
            if (now - (recent.current.get(f.rawValue) ?? 0) < 5000) continue;
            recent.current.set(f.rawValue, now);
            void submit(f.rawValue);
          }
        }, 300);
      })
      .catch(() => {
        setCameraError("Could not open the camera. Allow camera access, or use a USB scanner.");
        setCameraOn(false);
      });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraOn, submit]);

  async function saveLateAfter() {
    try {
      await api("/school", { method: "PATCH", body: { attendanceLateAfter: lateAfter } });
      await school.reload();
      toast.success("Late cut-off saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function closeDay() {
    if (!window.confirm("Mark everyone who has not been scanned or marked today as absent? Do this at the end of the school day.")) return;
    try {
      const r = await api<{ studentsMarkedAbsent: number; staffMarkedAbsent: number }>("/attendance/scan/close", { method: "POST", body: {} });
      toast.success(`Marked ${r.studentsMarkedAbsent} students and ${r.staffMarkedAbsent} staff absent`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const cutoff = lateAfter || school.data?.attendanceLateAfter || "";

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          icon={<ScanLine />}
          title="Scan ID cards"
          description="Scan the QR code on a student or staff ID card. Arrivals after the cut-off are marked late."
        />
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <TextField
            ref={inputRef}
            label="Scan or type a code"
            name="code"
            autoFocus
            autoComplete="off"
            placeholder="Click here, then scan with a USB scanner"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            hint="A USB scanner types the code and presses Enter. You can also type an admission or employee number."
            wrapperClassName="w-full sm:w-96"
          />
          <Button type="submit" loading={busy} disabled={!code.trim()}>
            Mark attendance
          </Button>
          <Button type="button" variant="secondary" icon={cameraOn ? <CameraOff /> : <Camera />} onClick={() => { setCameraError(""); setCameraOn((on) => !on); }}>
            {cameraOn ? "Stop camera" : "Use camera"}
          </Button>
        </form>
        {cameraError && <Alert tone="warning" className="mt-3">{cameraError}</Alert>}
        {cameraOn && <video ref={videoRef} muted playsInline className="mt-4 aspect-video w-full max-w-md rounded-lg bg-black" aria-label="Camera preview" />}
      </Card>

      <Card padding="none">
        <div className="border-b border-border px-4 py-3 text-sm font-medium text-fg">Recent scans</div>
        {log.length === 0 ? (
          <p className="px-4 py-6 text-sm text-fg-muted">Nothing scanned yet.</p>
        ) : (
          <ul className="divide-y divide-border" aria-live="polite">
            {log.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                {e.result ? (
                  <>
                    <span className="font-medium text-fg">{e.result.name}</span>
                    <span className="text-fg-muted">{e.result.detail}</span>
                    <span className="ml-auto flex items-center gap-2">
                      {e.result.result === "already" && <span className="text-xs text-fg-muted">Already marked</span>}
                      <Badge tone={e.result.status === "LATE" ? "warning" : e.result.status === "PRESENT" ? "success" : "info"}>
                        {META_BY_STATUS[e.result.status].label}
                      </Badge>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-xs text-fg-muted">{e.code}</span>
                    <span className="ml-auto text-danger-text">{e.error}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader icon={<Sunset />} title="Scan settings" description="School-wide, for administrators." />
          <div className="flex flex-wrap items-end gap-3">
            <TextField
              label="Late after"
              type="time"
              value={cutoff}
              onChange={(e) => setLateAfter(e.target.value)}
              hint="Scans after this time (school local time) count as late."
              wrapperClassName="w-full sm:w-44"
            />
            <Button type="button" variant="secondary" onClick={saveLateAfter} disabled={!lateAfter || lateAfter === school.data?.attendanceLateAfter}>
              Save cut-off
            </Button>
            <Button type="button" variant="secondary" onClick={closeDay} className="sm:ml-auto">
              Close the day
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
