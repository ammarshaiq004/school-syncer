"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/** A QR code for a link, drawn in the browser so it prints crisp. Shows a soft placeholder until it is drawn. */
export function QrCode({ value, size = 96, className = "" }: { value: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).then(
      (s) => !cancelled && setSvg(s),
      () => !cancelled && setSvg(""),
    );
    return () => {
      cancelled = true;
    };
  }, [value]);
  return (
    <div
      className={cn("shrink-0 [&>svg]:h-full [&>svg]:w-full", !svg && "animate-pulse rounded-sm bg-black/5 print:bg-transparent", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`QR code for ${value}`}
      aria-busy={!svg || undefined}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
