import { packClientId } from "@/lib/oauth";

export const dynamic = "force-dynamic";

function isAllowedRedirectUri(uri: string) {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) return true;
    return false;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "Body invalido." }, { status: 400 });
  }

  const redirectUris = (body as { redirect_uris?: unknown })?.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((uri) => typeof uri === "string")) {
    return Response.json(
      { error: "invalid_client_metadata", error_description: "redirect_uris es requerido." },
      { status: 400 },
    );
  }
  if (!redirectUris.every(isAllowedRedirectUri)) {
    return Response.json(
      { error: "invalid_redirect_uri", error_description: "Alguna redirect_uri no es valida." },
      { status: 400 },
    );
  }

  const clientName = (body as { client_name?: unknown })?.client_name;
  const clientId = packClientId({
    redirectUris,
    clientName: typeof clientName === "string" ? clientName : undefined,
  });

  return Response.json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
}
