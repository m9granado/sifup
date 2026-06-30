import { readFile } from "node:fs/promises";
import postgres from "postgres";

const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/run-sql.mjs <sql-file>");
  process.exit(1);
}

async function loadLocalEnv() {
  if (process.env.DATABASE_URL) return;
  try {
    const content = await readFile(".env.local", "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
      if (match) {
        process.env.DATABASE_URL = match[1].replace(/^['"]|['"]$/g, "");
        return;
      }
    }
  } catch {
    // .env.local is optional; CI and Vercel can provide DATABASE_URL directly.
  }
}

await loadLocalEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: process.env.DATABASE_URL.includes("sslmode=") ? undefined : "require",
});

try {
  const content = await readFile(file, "utf8");
  await sql.unsafe(content);
  console.log(`Applied ${file}`);
} finally {
  await sql.end();
}
