import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const productionDatabaseUrl = process.env.PRODUCTION_DATABASE_URL?.trim();

if (!productionDatabaseUrl) {
  console.error("PRODUCTION_DATABASE_URL is not set. Add it to your shell or .env.local before running a production Prisma command.");
  process.exit(1);
}

const child = spawn("npx", ["prisma", ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: productionDatabaseUrl,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
