import fs from "node:fs/promises";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../src/generated/prisma/index.js";

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

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set.");
  }

  return databaseUrl;
}

function parseSubscribedAt(value) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseStatus({ statusValue, tagsValue }) {
  const normalizedStatus = statusValue?.trim().toLowerCase();

  if (normalizedStatus === "unsubscribed") {
    return "unsubscribed";
  }

  const normalizedTags = tagsValue?.trim().toLowerCase() ?? "";
  if (normalizedTags.includes("unsubscribed")) {
    return "unsubscribed";
  }

  return "active";
}

async function main() {
  const [csvPath] = process.argv.slice(2);

  if (!csvPath) {
    throw new Error("Usage: node scripts/import-subscribers-from-csv.mjs <path-to-export.csv>");
  }

  const csv = await fs.readFile(csvPath, "utf8");
  const [headerLine, ...rows] = csv.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine).map((value) => value.toLowerCase());
  const emailIndex = headers.indexOf("email");
  const statusIndex = headers.indexOf("status");
  const subscribedAtIndex = headers.indexOf("subscribed_at");
  const createdIndex = headers.indexOf("created");
  const firstNameIndex = headers.indexOf("first name");
  const tagsIndex = headers.indexOf("tags");

  if (emailIndex < 0) {
    throw new Error("CSV must include an email column.");
  }

  const pool = new Pool({
    connectionString: getDatabaseUrl(),
    ssl: {
      rejectUnauthorized: false,
    },
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
  });
  let processed = 0;

  try {
    for (const row of rows) {
      const values = parseCsvLine(row);
      const email = values[emailIndex]?.trim().toLowerCase();

      if (!email) {
        continue;
      }

      const firstName = firstNameIndex >= 0 ? values[firstNameIndex]?.trim() || null : null;
      const status = parseStatus({
        statusValue: statusIndex >= 0 ? values[statusIndex] : null,
        tagsValue: tagsIndex >= 0 ? values[tagsIndex] : null,
      });
      const subscribedAtValue = subscribedAtIndex >= 0 ? values[subscribedAtIndex] : createdIndex >= 0 ? values[createdIndex] : null;
      const subscribedAt = parseSubscribedAt(subscribedAtValue);

      await prisma.subscriber.upsert({
        where: { email },
        update: {
          firstName: firstName ?? undefined,
          status,
          source: "ghl_import",
          lastSeenAt: new Date(),
        },
        create: {
          email,
          firstName,
          status,
          source: "ghl_import",
          subscribedAt,
          lastSeenAt: new Date(),
        },
      });

      processed += 1;
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }

  console.log(`Subscriber import completed. Processed ${processed} row(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
