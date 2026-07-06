import "server-only";

import { createHash, createHmac, timingSafeEqual } from "crypto";

const CODE_TTL_SECONDS = 5 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 365;

function getSecret() {
  return process.env.SESSION_SECRET || "dev-only-change-me";
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string, purpose: string) {
  return createHmac("sha256", `${getSecret()}:oauth:${purpose}`).update(value).digest("base64url");
}

export function packToken<T extends object>(payload: T, purpose: string) {
  const body = base64url(JSON.stringify(payload));
  const signature = sign(body, purpose);
  return `${body}.${signature}`;
}

export function unpackToken<T>(token: string | null | undefined, purpose: string): T | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body, purpose);
  const actual = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export type ClientPayload = {
  redirectUris: string[];
  clientName?: string;
};

export function packClientId(payload: ClientPayload) {
  return packToken(payload, "client");
}

export function unpackClientId(clientId: string | null | undefined) {
  return unpackToken<ClientPayload>(clientId, "client");
}

export type AuthorizationCodePayload = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  exp: number;
};

export function packAuthorizationCode(payload: Omit<AuthorizationCodePayload, "exp">) {
  return packToken({ ...payload, exp: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS }, "code");
}

export function unpackAuthorizationCode(code: string | null | undefined) {
  return unpackToken<AuthorizationCodePayload>(code, "code");
}

export type RefreshTokenPayload = {
  clientId: string;
  exp: number;
};

export function packRefreshToken(clientId: string) {
  return packToken({ clientId, exp: Math.floor(Date.now() / 1000) + REFRESH_TTL_SECONDS }, "refresh");
}

export function unpackRefreshToken(token: string | null | undefined) {
  return unpackToken<RefreshTokenPayload>(token, "refresh");
}

export function verifyPkce(codeVerifier: string, codeChallenge: string) {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  const computedBuffer = Buffer.from(computed);
  const expectedBuffer = Buffer.from(codeChallenge);
  return computedBuffer.length === expectedBuffer.length && timingSafeEqual(computedBuffer, expectedBuffer);
}
