import "server-only";

import postgres from "postgres";

let sqlClient: postgres.Sql | null = null;

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_DATABASE);
}

export function getSql() {
  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_DATABASE;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!sqlClient) {
    sqlClient = postgres(connectionString, {
      max: 1,
      prepare: false,
      ssl: "require",
    });
  }

  return sqlClient;
}
