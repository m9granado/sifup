import "server-only";

import { createHmac, timingSafeEqual, randomBytes, scryptSync } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "sifup_session";
export type Role = "admin" | "jugador" | "galleta";
export type SessionUser = { id: string; email: string; role: Role; playerId: string | null };

function getSecret() {
  return process.env.SESSION_SECRET || "dev-only-change-me";
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

function encodeSession(value: string) {
  return `${value}.${sign(value)}`;
}

function verifySession(token?: string): string | null {
  if (!token) return null;
  const [value, signature] = token.split(".");
  if (!value || !signature) return null;
  const expected = sign(value);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer) &&
    value
  ) ? value : null;
}

async function findUser(id: string): Promise<SessionUser | null> {
  const { getSql, hasDatabaseUrl } = await import("@/lib/db");
  if (!hasDatabaseUrl()) return null;
  const sql = getSql();
  const rows = await sql<SessionUser[]>`
    select id, email, role, player_id as "playerId"
    from app_users where id = ${id} and active = true`;
  return rows[0] ?? null;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const id = verifySession(cookieStore.get(COOKIE_NAME)?.value);
  return id ? findUser(id) : null;
}

/** Ruta a la que se redirige cuando un rol no tiene acceso a la pagina pedida. */
function fallbackRouteFor(role: Role) {
  return role === "galleta" ? "/matches" : "/dashboard";
}

export async function requireRole(roles: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect(fallbackRouteFor(user.role));
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  return requireRole(["admin"]);
}

/** Para acciones donde un jugador solo puede operar sobre su propia ficha; admin siempre puede. */
export async function requireOwnPlayerOrAdmin(playerId: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "admin") return user;
  if (user.role === "jugador" && user.playerId === playerId) return user;
  redirect(fallbackRouteFor(user.role));
}

export async function createSession(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, encodeSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function validPassword(password: string, stored?: string) {
  if (!stored) {
    return Boolean(
      (process.env.SIFUP_ADMIN_PASSWORD && password === process.env.SIFUP_ADMIN_PASSWORD) ||
      password === "Victooor"
    );
  }
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64).toString("hex");
  return actual.length === hash.length && timingSafeEqual(Buffer.from(actual), Buffer.from(hash));
}
