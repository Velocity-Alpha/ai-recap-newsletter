// Resets the Neon `dev` branch to a fresh copy of `production`, then replaces subscriber data
// (newsletter.subscribers and newsletter.auth_codes) with fake rows, so no real email address
// stays on a non-production branch.
//
// Usage:   NEON_PROJECT_ID=<id> node scripts/reset-dev-branch.mjs --yes [--role <name>] [--database <name>]
// Needs:   a Neon CLI login (`npx neonctl auth`) with access to the project.
// Effect:  everything on `dev` is replaced. Production is only read.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import pg from "pg";

export const SOURCE_BRANCH = "production";
export const TARGET_BRANCH = "dev";

export const FAKE_SUBSCRIBERS = [
  { email: "dev-reader-1@example.com", status: "active", source: "dev_seed", firstName: "Ada" },
  { email: "dev-reader-2@example.com", status: "active", source: "dev_seed", firstName: null },
  { email: "dev-unsubscribed@example.com", status: "unsubscribed", source: "dev_seed", firstName: "Lin" },
];

export function assertSafeReset(branches, { source, target }) {
  if (source === target) {
    throw new Error(`Source and target are the same branch: ${source}`);
  }

  const sourceBranch = branches.find((branch) => branch.name === source);
  const targetBranch = branches.find((branch) => branch.name === target);

  if (!sourceBranch) throw new Error(`Source branch not found: ${source}`);
  if (!targetBranch) throw new Error(`Target branch not found: ${target}`);
  if (targetBranch.default) throw new Error(`Refusing to reset the default branch: ${target}`);
  if (targetBranch.protected) throw new Error(`Refusing to reset a protected branch: ${target}`);
  if (targetBranch.parent_id !== sourceBranch.id) {
    throw new Error(`The parent of ${target} is not ${source}, so a reset would not copy ${source}`);
  }

  return { sourceBranch, targetBranch };
}

export function buildScrubStatements(fakeSubscribers) {
  const placeholders = fakeSubscribers
    .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
    .join(",\n  ");

  return [
    { text: "DELETE FROM newsletter.auth_codes", values: [] },
    { text: "DELETE FROM newsletter.subscribers", values: [] },
    {
      text: `INSERT INTO newsletter.subscribers (email, status, source, first_name)\nVALUES\n  ${placeholders}`,
      values: fakeSubscribers.flatMap((s) => [s.email, s.status, s.source, s.firstName]),
    },
  ];
}

export const SCRUB_CHECK_SQL = `
  SELECT
    (SELECT count(*) FROM newsletter.auth_codes)::int AS auth_codes,
    (SELECT count(*) FROM newsletter.subscribers WHERE email NOT LIKE '%@example.com')::int AS real_subscribers,
    (SELECT count(*) FROM newsletter.subscribers)::int AS subscribers
`;

export function checkScrubResult({ auth_codes, real_subscribers }) {
  if (real_subscribers !== 0) throw new Error(`${real_subscribers} real subscriber rows remain on ${TARGET_BRANCH}`);
  if (auth_codes !== 0) throw new Error(`${auth_codes} login codes remain on ${TARGET_BRANCH}`);
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function neonctl(args) {
  return execFileSync("npx", ["--yes", "neonctl", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

async function main() {
  const projectId = process.env.NEON_PROJECT_ID?.trim();
  if (!projectId) throw new Error("NEON_PROJECT_ID is not set.");

  if (!process.argv.includes("--yes")) {
    console.log(
      `This replaces everything on the Neon "${TARGET_BRANCH}" branch with a copy of "${SOURCE_BRANCH}",\n` +
        "then swaps subscribers and login codes for fake rows. Run again with --yes to continue.",
    );
    process.exitCode = 1;
    return;
  }

  const project = ["--project-id", projectId];
  const branches = JSON.parse(neonctl(["branches", "list", ...project, "--output", "json"]));
  assertSafeReset(branches, { source: SOURCE_BRANCH, target: TARGET_BRANCH });

  console.log(`Resetting ${TARGET_BRANCH} from ${SOURCE_BRANCH}...`);
  neonctl(["branches", "reset", TARGET_BRANCH, "--parent", ...project, "--output", "json"]);

  const connectionArgs = ["connection-string", TARGET_BRANCH, ...project];
  const role = getArg("--role");
  const database = getArg("--database");
  if (role) connectionArgs.push("--role-name", role);
  if (database) connectionArgs.push("--database-name", database);
  // The connection string holds a password. It is used here and never printed.
  const connectionString = neonctl(connectionArgs).trim();

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const statement of buildScrubStatements(FAKE_SUBSCRIBERS)) {
      await client.query(statement.text, statement.values);
    }
    await client.query("COMMIT");

    const { rows } = await client.query(SCRUB_CHECK_SQL);
    checkScrubResult(rows[0]);
    console.log(
      `Done. ${TARGET_BRANCH} has ${rows[0].subscribers} fake subscribers, 0 real subscribers and 0 login codes.`,
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
