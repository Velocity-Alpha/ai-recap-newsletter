import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "@/generated/prisma";

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return databaseUrl;
}

const globalForPrisma = globalThis as typeof globalThis & {
  pgPool?: Pool;
  prisma?: PrismaClient;
};

function getPool() {
  if (!globalForPrisma.pgPool) {
    globalForPrisma.pgPool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  return globalForPrisma.pgPool;
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg(getPool()),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export function getPrisma() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getPrisma(), property, receiver);
  },
});
