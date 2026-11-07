"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Alert, Button, Dialog } from "@/components/ui";

/** Why the camera could not start, in words a school clerk can act on. */
function cameraProblem(e: unknown): string {
  const name = (e as { name?: string }).name;
  if (name === "NotAllowedError") return "The browser was not allowed to use the camera. Allow the camera for this site (the lock icon in the address bar) and try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this computer.";
  if (name === "NotReadableError") return "The camera is being used by another program. Close it and try again.";
  return "The camera could not be started.";
}

const hasCamera = () => typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";

const UNSUPPORTED = "This browser cannot use the camera. Use Chrome, Edge or Safari over a secure (https) connection.";

/** The live picture and the shutter button; mounted only while the dialog is open, so the camera is off otherwise. */
function CameraView({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(() => (hasCamera() ? "" : UNSUPPORTED));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasCamera()) return;
    let stream: MediaStream | undefined;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false }).then(
      (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
      },
      (e: unknown) => !cancelled && setError(cameraProblem(e)),
    );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function take() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // Passport-style 3:4 crop from the middle of the picture.
    const h = v.videoHeight;
    const w = Math.min(v.videoWidth, Math.round((h * 3) / 4));
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(w, 600);
    canvas.height = Math.round((canvas.width * 4) / 3);
    canvas.getContext("2d")?.drawImage(v, (v.videoWidth - w) / 2, 0, w, h, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return setError("The photo could not be taken. Try again.");
        onCapture(new File([blob], "webcam-photo.jpg", { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.9,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : (
        <div className="mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-xl bg-black">
          {/* Mirrored like a mirror; the saved photo is not. */}
          <video ref={video} autoPlay playsInline muted onLoadedMetadata={() => setReady(true)} className="size-full -scale-x-100 object-cover" />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="button" icon={<Camera />} disabled={!ready || !!error} onClick={take}>Take photo</Button>
      </div>
    </div>
  );
}

/**
 * Takes a student's photo with the computer's webcam (or a phone's camera)
 * and hands it back as a JPEG file, the same as picking a file from disk.
 */
export function WebcamCapture({ open, onOpenChange, onCapture }: { open: boolean; onOpenChange: (open: boolean) => void; onCapture: (file: File) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Take a photo" description="Ask the student to face the camera, centred in the frame.">
      {open && <CameraView onCapture={onCapture} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}
