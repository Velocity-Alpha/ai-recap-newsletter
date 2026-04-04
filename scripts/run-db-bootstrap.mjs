import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.join(__dirname, "..", ".env.local"),
});

function getArgValue(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  return process.argv[index + 1] ?? fallback;
}

function getDatabaseUrl(envName) {
  const databaseUrl = process.env[envName]?.trim();

  if (!databaseUrl) {
    throw new Error(`${envName} is not set.`);
  }

  return databaseUrl;
}

function getRuntimeRole() {
  const runtimeRole = process.env.NEWSLETTER_RUNTIME_DB_ROLE?.trim() || "newsletter_web";

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(runtimeRole)) {
    throw new Error(`NEWSLETTER_RUNTIME_DB_ROLE is invalid: ${runtimeRole}`);
  }

  return runtimeRole;
}

function shouldUseSsl(connectionString) {
  return /sslmode=/i.test(connectionString);
}

async function main() {
  const urlEnv = getArgValue("--url-env", "DATABASE_URL");
  const file = getArgValue("--file", "prisma/bootstrap/001_grant_newsletter_web.sql");
  const sqlPath = path.resolve(__dirname, "..", file);
  const sql = await fs.readFile(sqlPath, "utf8");
  const connectionString = getDatabaseUrl(urlEnv);
  const runtimeRole = getRuntimeRole();

  const client = new Client({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
  });

  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.runtime_role', $1, true)", [runtimeRole]);
    await client.query(sql);
    await client.query("COMMIT");

    console.log(`Database bootstrap applied from ${file} for role ${runtimeRole} using ${urlEnv}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
