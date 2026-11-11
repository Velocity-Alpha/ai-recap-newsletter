import { Client } from "pg";

/**
 * Read-only queries on the Neon `dev` branch, for evals that need story text the fixtures do not hold.
 * Every query runs in a READ ONLY transaction, so it cannot write. Never point DATABASE_URL at production.
 * Returns null when DATABASE_URL is not set, so the eval can fall back and say so.
 */
export async function readOnlyQuery<Row>(sql: string, params: unknown[] = []): Promise<Row[] | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (process.env.PRODUCTION_DATABASE_URL && url === process.env.PRODUCTION_DATABASE_URL) {
    throw new Error("DATABASE_URL is the production database. Evals read the Neon dev branch only.");
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(sql, params);
    await client.query("ROLLBACK");
    return result.rows as Row[];
  } finally {
    await client.end();
  }
}
