import { packRefreshToken, unpackAuthorizationCode, unpackRefreshToken, verifyPkce } from "@/lib/oauth";

export const dynamic = "force-dynamic";

function errorResponse(error: string, description: string, status = 400) {
  return Response.json({ error, error_description: description }, { status });
}

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  const form = await request.formData();
  return Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
}

function issueTokens(clientId: string) {
  const accessToken = process.env.SIFUP_MCP_TOKEN;
  if (!accessToken) return null;
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 60 * 60 * 24 * 30,
    refresh_token: packRefreshToken(clientId),
    scope: "mcp",
  };
}

export async function POST(request: Request) {
  const body = await readBody(request);
  const grantType = body.grant_type;

  if (grantType === "authorization_code") {
    const code = typeof body.code === "string" ? body.code : null;
    const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : null;
    const clientId = typeof body.client_id === "string" ? body.client_id : null;
    const codeVerifier = typeof body.code_verifier === "string" ? body.code_verifier : null;

    if (!code || !redirectUri || !clientId || !codeVerifier) {
      return errorResponse("invalid_request", "Faltan parametros requeridos.");
    }

    const payload = unpackAuthorizationCode(code);
    if (!payload) return errorResponse("invalid_grant", "Codigo invalido o expirado.");
    if (payload.clientId !== clientId) return errorResponse("invalid_grant", "client_id no coincide.");
    if (payload.redirectUri !== redirectUri) return errorResponse("invalid_grant", "redirect_uri no coincide.");
    if (!verifyPkce(codeVerifier, payload.codeChallenge)) {
      return errorResponse("invalid_grant", "code_verifier invalido.");
    }

    const tokens = issueTokens(clientId);
    if (!tokens) return errorResponse("server_error", "SIFUP_MCP_TOKEN no configurado.", 500);
    return Response.json(tokens);
  }

  if (grantType === "refresh_token") {
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : null;
    if (!refreshToken) return errorResponse("invalid_request", "refresh_token es requerido.");

    const payload = unpackRefreshToken(refreshToken);
    if (!payload) return errorResponse("invalid_grant", "refresh_token invalido o expirado.");

    const tokens = issueTokens(payload.clientId);
    if (!tokens) return errorResponse("server_error", "SIFUP_MCP_TOKEN no configurado.", 500);
    return Response.json(tokens);
  }

  return errorResponse("unsupported_grant_type", "grant_type no soportado.");
}
