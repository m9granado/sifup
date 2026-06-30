import "server-only";

import postgres from "postgres";

let sqlClient: postgres.Sql | null = null;

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

export function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!sqlClient) {
    sqlClient = postgres(process.env.DATABASE_URL, {
      max: 1,
      prepare: false,
      ssl: process.env.DATABASE_URL.includes("sslmode=") ? undefined : "require",
    });
  }

  return sqlClient;
}
