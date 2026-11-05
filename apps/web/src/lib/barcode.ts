/** A barcode's modules ("1" bar, "0" space) as runs of bars: x is the start module, w the width in modules. */
export function barRuns(modules: string): { x: number; w: number }[] {
  const runs: { x: number; w: number }[] = [];
  let x = 0;
  for (const run of modules.match(/1+|0+/g) ?? []) {
    if (run[0] === "1") runs.push({ x, w: run.length });
    x += run.length;
  }
  return runs;
}
