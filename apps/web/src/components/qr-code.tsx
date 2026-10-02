"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** A QR code for a link, drawn in the browser so it prints crisp. */
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
      className={`[&>svg]:h-full [&>svg]:w-full ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`QR code for ${value}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
