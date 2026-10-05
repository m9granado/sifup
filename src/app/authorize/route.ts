import { getCurrentUser } from "@/lib/auth";
import { packAuthorizationCode, unpackClientId } from "@/lib/oauth";
import { canAutoApproveConsent } from "@/lib/oauth-policy";

export const dynamic = "force-dynamic";

type AuthorizeParams = {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  state: string | null;
};

function readParams(params: URLSearchParams): AuthorizeParams {
  return {
    responseType: params.get("response_type"),
    clientId: params.get("client_id"),
    redirectUri: params.get("redirect_uri"),
    codeChallenge: params.get("code_challenge"),
    codeChallengeMethod: params.get("code_challenge_method"),
    state: params.get("state"),
  };
}

function validateRequest({ responseType, clientId, redirectUri, codeChallenge, codeChallengeMethod }: AuthorizeParams) {
  if (responseType !== "code") return "response_type debe ser 'code'.";
  if (!clientId) return "client_id es requerido.";
  if (!redirectUri) return "redirect_uri es requerido.";
  if (!codeChallenge) return "code_challenge es requerido.";
  if (codeChallengeMethod !== "S256") return "code_challenge_method debe ser 'S256'.";

  const client = unpackClientId(clientId);
  if (!client) return "client_id invalido o expirado.";
  if (!client.redirectUris.includes(redirectUri)) return "redirect_uri no registrada para este cliente.";

  return null;
}

function renderShell(bodyHtml: string) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autorizar SIFUP MCP</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f9fafb; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  main { width: 100%; max-width: 380px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); box-sizing: border-box; }
  h1 { font-size: 1.25rem; margin: 0 0 8px; color: #111827; }
  p { font-size: 0.9rem; color: #4b5563; line-height: 1.5; }
  button { margin-top: 20px; width: 100%; padding: 10px; background: #047857; color: #fff; border: none; border-radius: 6px; font-size: 0.95rem; cursor: pointer; }
  button:hover { background: #065f46; }
  button:focus-visible { outline: 3px solid #a7f3d0; outline-offset: 2px; }
  button.deny-btn { margin-top: 8px; background: #fff; color: #4b5563; border: 1px solid #d1d5db; }
  button.deny-btn:hover { background: #f3f4f6; }
  a.login-link { display: inline-block; margin-top: 20px; width: 100%; box-sizing: border-box; text-align: center; padding: 10px; background: #047857; color: #fff; border-radius: 6px; font-size: 0.95rem; text-decoration: none; }
  a.login-link:hover { background: #065f46; }
  a.login-link:focus-visible { outline: 3px solid #a7f3d0; outline-offset: 2px; }
  code, strong { word-break: break-all; overflow-wrap: anywhere; }
</style>
</head>
<body>
<main>
  <p style="text-transform:uppercase;letter-spacing:0.12em;font-size:0.75rem;font-weight:600;color:#047857;">SIFUP</p>
  <h1>Autorizar acceso MCP</h1>
  ${bodyHtml}
</main>
</body>
</html>`;
}

function authorizeFieldEntries(params: AuthorizeParams): [string, string | null][] {
  return [
    ["response_type", params.responseType],
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["code_challenge", params.codeChallenge],
    ["code_challenge_method", params.codeChallengeMethod],
    ["state", params.state],
  ];
}

function renderHiddenFields(params: AuthorizeParams) {
  return authorizeFieldEntries(params)
    .filter(([, value]) => typeof value === "string")
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value as string)}">`)
    .join("\n");
}

function buildAuthorizeNext(params: AuthorizeParams) {
  const qs = new URLSearchParams();
  for (const [name, value] of authorizeFieldEntries(params)) {
    if (typeof value === "string") qs.set(name, value);
  }
  return `/authorize?${qs.toString()}`;
}

// Only called for fully-validated requests (error is always null here) — never pair this with an error message or an unvalidated next.
function renderDeniedPage(options: { next: string; user?: { email: string } | null; params: AuthorizeParams }) {
  const { next, user, params } = options;
  const loginHref = `/login?next=${encodeURIComponent(next)}`;
  const notice = user
    ? `<p>Tu sesion actual (<strong>${escapeHtml(user.email)}</strong>) no tiene permisos de administrador y no puede aprobar esta conexion.</p>`
    : `<p>Necesitas una sesion de administrador activa para ver y aprobar esta conexion.</p>`;
  const linkLabel = user ? "Cambiar de cuenta" : "Iniciar sesion";
  return renderShell(`
  ${notice}
  <a class="login-link" href="${loginHref}" autofocus>${linkLabel}</a>
  <form method="POST">
    ${renderHiddenFields(params)}
    <button type="submit" name="intent" value="deny" class="deny-btn">Cancelar</button>
  </form>`);
}

function renderConsentPage(options: { params: AuthorizeParams; clientName?: string }) {
  const { params, clientName } = options;
  return renderShell(`
  <p><strong>${clientName ? escapeHtml(clientName) : "Una aplicacion"}</strong> quiere conectarse al MCP privado de SIFUP con tu sesion de admin. Este nombre lo declara el cliente y no esta verificado.</p>
  <p>Si autorizas, esa aplicacion podra <strong>leer y modificar</strong> partidos, jugadores y pagos de SIFUP.</p>
  <p>Destino de retorno: <code>${params.redirectUri ? escapeHtml(params.redirectUri) : "(sin especificar)"}</code></p>
  <p>Autoriza solo si tu fuiste quien inicio esta conexion.</p>
  <form method="POST">
    ${renderHiddenFields(params)}
    <button type="submit" name="intent" value="allow" autofocus>Autorizar</button>
    <button type="submit" name="intent" value="deny" class="deny-btn">Cancelar</button>
  </form>`);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = readParams(url.searchParams);
  const error = validateRequest(params);

  // Any invalid request (unknown client, unregistered redirect_uri, bad PKCE params, ...) gets a plain 400 — never a CTA or a next built from unverified params.
  if (error) {
    return new Response(error, { status: 400 });
  }

  const client = unpackClientId(params.clientId);
  const user = await getCurrentUser();
  if (canAutoApproveConsent(user?.role)) {
    return new Response(renderConsentPage({ params, clientName: client?.clientName }), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response(renderDeniedPage({ next: buildAuthorizeNext(params), user, params }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const params = readParams(new URLSearchParams(Array.from(form.entries()).map(([key, value]) => [key, String(value)])));
  const error = validateRequest(params);
  const intent = form.get("intent");

  // Cancel only redirects once client_id/redirect_uri are verified; an invalid request falls through to the 400 below, never to a redirect.
  if (intent === "deny" && !error) {
    const redirectTarget = new URL(params.redirectUri as string);
    redirectTarget.searchParams.set("error", "access_denied");
    if (params.state) redirectTarget.searchParams.set("state", params.state);
    return Response.redirect(redirectTarget.toString(), 303);
  }

  if (error) {
    return new Response(error, { status: 400 });
  }

  if (intent !== "allow") {
    return new Response("intent invalido.", { status: 400 });
  }

  const user = await getCurrentUser();
  if (!canAutoApproveConsent(user?.role)) {
    return new Response(renderDeniedPage({ next: buildAuthorizeNext(params), user, params }), {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const code = packAuthorizationCode({
    clientId: params.clientId as string,
    redirectUri: params.redirectUri as string,
    codeChallenge: params.codeChallenge as string,
  });

  const redirectTarget = new URL(params.redirectUri as string);
  redirectTarget.searchParams.set("code", code);
  if (params.state) redirectTarget.searchParams.set("state", params.state);

  return Response.redirect(redirectTarget.toString(), 303);
}
