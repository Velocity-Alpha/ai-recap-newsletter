import fs from "fs/promises";
import { Pool } from "pg";

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

async function main() {
  const [csvPath] = process.argv.slice(2);

  if (!csvPath) {
    throw new Error("Usage: node scripts/import-subscribers-from-csv.mjs <path-to-export.csv>");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set.");
  }

  const csv = await fs.readFile(csvPath, "utf8");
  const [headerLine, ...rows] = csv.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine).map((value) => value.toLowerCase());
  const emailIndex = headers.indexOf("email");
  const statusIndex = headers.indexOf("status");
  const subscribedAtIndex = headers.indexOf("subscribed_at");

  if (emailIndex < 0) {
    throw new Error("CSV must include an email column.");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    for (const row of rows) {
      const values = parseCsvLine(row);
      const email = values[emailIndex]?.trim().toLowerCase();

      if (!email) {
        continue;
      }

      const status = values[statusIndex]?.trim() === "unsubscribed" ? "unsubscribed" : "active";
      const subscribedAt = subscribedAtIndex >= 0 ? values[subscribedAtIndex] || null : null;

      await pool.query(
        `INSERT INTO newsletter.subscribers (
           email,
           status,
           source,
           subscribed_at,
           last_seen_at
         )
         VALUES ($1, $2, 'ghl_import', COALESCE($3::timestamptz, now()), now())
         ON CONFLICT (email)
         DO UPDATE SET
           status = EXCLUDED.status,
           source = 'ghl_import'`,
        [email, status, subscribedAt],
      );
    }
  } finally {
    await pool.end();
  }

  console.log("Subscriber import completed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
