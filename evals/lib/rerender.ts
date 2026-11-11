// Rebuilds results files from the rows stored in them, with no API calls: `npm run eval:rerender -- <task...>`.
// Use it after a change to how results are shown. evals/README.md.
import { rerenderResults } from "@/evals/lib/results";

const tasks = process.argv.slice(2).filter((arg) => arg !== "--");
if (tasks.length === 0) {
  console.error("Usage: npm run eval:rerender -- <task...>   (for example: writer free-links)");
  process.exit(1);
}
for (const task of tasks) console.info(`Wrote ${rerenderResults(task)}`);
