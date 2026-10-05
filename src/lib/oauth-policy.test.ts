import assert from "node:assert/strict";
import test from "node:test";
import { buildResourceMetadataChallenge, canAutoApproveConsent, sanitizeAuthorizeNext } from "./oauth-policy";

test("el challenge WWW-Authenticate referencia resource_metadata segun RFC9728/MCP", () => {
  const header = buildResourceMetadataChallenge("https://sifup.vercel.app/.well-known/oauth-protected-resource");
  assert.equal(header, 'Bearer resource_metadata="https://sifup.vercel.app/.well-known/oauth-protected-resource"');
});

test("sesion admin puede auto-aprobar el consentimiento de /authorize", () => {
  assert.equal(canAutoApproveConsent("admin"), true);
});

test("sesion member NO auto-aprueba (denegado, no es sesion admin)", () => {
  assert.equal(canAutoApproveConsent("member"), false);
});

test("sin sesion NO auto-aprueba (denegado, no hay sesion admin)", () => {
  assert.equal(canAutoApproveConsent(null), false);
  assert.equal(canAutoApproveConsent(undefined), false);
});

test("sanitizeAuthorizeNext acepta /authorize con query string", () => {
  assert.equal(
    sanitizeAuthorizeNext("/authorize?client_id=abc&state=xyz"),
    "/authorize?client_id=abc&state=xyz",
  );
  assert.equal(sanitizeAuthorizeNext("/authorize"), "/authorize");
});

test("sanitizeAuthorizeNext rechaza destinos fuera de /authorize (anti open-redirect)", () => {
  assert.equal(sanitizeAuthorizeNext(null), null);
  assert.equal(sanitizeAuthorizeNext(undefined), null);
  assert.equal(sanitizeAuthorizeNext(""), null);
  assert.equal(sanitizeAuthorizeNext("/dashboard"), null);
  assert.equal(sanitizeAuthorizeNext("//evil.com/authorize"), null);
  assert.equal(sanitizeAuthorizeNext("https://evil.com/authorize"), null);
  assert.equal(sanitizeAuthorizeNext("/authorize/../login"), null);
  assert.equal(sanitizeAuthorizeNext("/authorizefoo"), null);
});
