import { validPassword } from "@/lib/auth";
import { packAuthorizationCode, unpackClientId } from "@/lib/oauth";

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

function renderPage(options: { params: AuthorizeParams; error?: string; clientName?: string }) {
  const { params, error, clientName } = options;
  const hiddenFields = [
    ["response_type", params.responseType],
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["code_challenge", params.codeChallenge],
    ["code_challenge_method", params.codeChallengeMethod],
    ["state", params.state],
  ]
    .filter(([, value]) => typeof value === "string")
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value as string)}">`)
    .join("\n");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autorizar SIFUP MCP</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f9fafb; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  main { width: 100%; max-width: 380px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  h1 { font-size: 1.25rem; margin: 0 0 8px; color: #111827; }
  p { font-size: 0.9rem; color: #4b5563; line-height: 1.5; }
  label { display: block; font-size: 0.85rem; color: #374151; margin: 16px 0 4px; }
  input[type="password"] { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.95rem; }
  button { margin-top: 20px; width: 100%; padding: 10px; background: #047857; color: #fff; border: none; border-radius: 6px; font-size: 0.95rem; cursor: pointer; }
  button:hover { background: #065f46; }
  .error { color: #b91c1c; font-size: 0.85rem; margin-top: 8px; }
</style>
</head>
<body>
<main>
  <p style="text-transform:uppercase;letter-spacing:0.12em;font-size:0.75rem;font-weight:600;color:#047857;">SIFUP</p>
  <h1>Autorizar acceso MCP</h1>
  <p>${clientName ? escapeHtml(clientName) : "Una aplicacion"} quiere conectarse al MCP privado de SIFUP. Ingresa la contrasena de admin para autorizar.</p>
  <form method="POST">
    ${hiddenFields}
    <label for="password">Contrasena</label>
    <input type="password" id="password" name="password" autofocus required>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <button type="submit">Autorizar</button>
  </form>
</main>
</body>
</html>`;
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

  if (error && !params.clientId) {
    return new Response(error, { status: 400 });
  }

  const client = params.clientId ? unpackClientId(params.clientId) : null;

  if (error) {
    // If client is invalid we can't trust redirect_uri, so show the error directly.
    if (!client || !params.redirectUri || !client.redirectUris.includes(params.redirectUri)) {
      return new Response(error, { status: 400 });
    }
  }

  return new Response(renderPage({ params, error: error ?? undefined, clientName: client?.clientName }), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const params = readParams(new URLSearchParams(Array.from(form.entries()).map(([key, value]) => [key, String(value)])));
  const error = validateRequest(params);
  const client = params.clientId ? unpackClientId(params.clientId) : null;

  if (error) {
    if (!client || !params.redirectUri || !client.redirectUris.includes(params.redirectUri)) {
      return new Response(error, { status: 400 });
    }
    return new Response(renderPage({ params, error, clientName: client.clientName }), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const password = form.get("password");
  if (typeof password !== "string" || !validPassword(password)) {
    return new Response(renderPage({ params, error: "Contrasena incorrecta.", clientName: client?.clientName }), {
      status: 401,
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
