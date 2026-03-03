import fs from "node:fs";
import path from "node:path";
import { BenchReport } from "./bench-core";

export function writeBenchReport(report: BenchReport, outDir: string): { jsonPath: string; markdownPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `velocity-bench-${stamp}.json`);
  const markdownPath = path.join(outDir, `velocity-bench-${stamp}.md`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const lines: string[] = [
    "# VELOCITY Benchmark Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "| Profile | p95 delta ms (max) | avg delta ms (max) | frame reduction (min) | byte reduction (min) | Result |",
    "|---|---:|---:|---:|---:|---|",
  ];

  for (const result of report.results) {
    lines.push(
      `| ${result.profile.name} | ${result.p95DeltaMs.toFixed(2)}ms (<=${result.profile.maxP95DeltaMs.toFixed(2)}ms) | ${result.avgDeltaMs.toFixed(2)}ms (<=${result.profile.maxAvgDeltaMs.toFixed(2)}ms) | ${result.frameReductionPct.toFixed(2)}% (>=${result.profile.minFrameReductionPct.toFixed(2)}%) | ${result.byteReductionPct.toFixed(2)}% (>=${result.profile.minByteReductionPct.toFixed(2)}%) | ${result.pass ? "PASS" : "WARN"} |`,
    );
  }

  lines.push("", `Pass: ${report.passCount}`, `Warn: ${report.failCount}`, "");
  fs.writeFileSync(markdownPath, `${lines.join("\n")}\n`, "utf8");
  return { jsonPath, markdownPath };
}
