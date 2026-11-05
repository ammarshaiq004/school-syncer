import { barRuns } from "@/lib/barcode";

/** A Code 128 barcode drawn as SVG (pure black bars, so scanners read it in print). */
export function Barcode({ modules, height = 40, label }: { modules: string; height?: number; label: string }) {
  // Code 128 needs a quiet zone of 10 modules on each side.
  const quiet = 10;
  const width = modules.length + quiet * 2;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none" className="h-10 w-full" shapeRendering="crispEdges">
      <rect width={width} height={height} fill="#fff" />
      {barRuns(modules).map((b) => (
        <rect key={b.x} x={b.x + quiet} width={b.w} height={height} fill="#000" />
      ))}
    </svg>
  );
}
