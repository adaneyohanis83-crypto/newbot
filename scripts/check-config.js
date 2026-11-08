// @ts-check
import path from "node:path";
import { inspectConfig } from "../src/config/check.js";
import { loadEnvFile } from "../src/utils/env-file.js";

const env = loadEnvFile(path.join(process.cwd(), ".env"));
const report = inspectConfig(env);
let failed = false;

for (const [title, issues] of [
  ["Webhook", report.webhookIssues],
  ["Packages", report.packageIssues],
]) {
  if (issues.length === 0) {
    console.log(`${title}: ok`);
    continue;
  }
  failed = true;
  console.log(`${title}:`);
  for (const issue of issues) console.log(`- ${issue}`);
}

process.exit(failed ? 1 : 0);
