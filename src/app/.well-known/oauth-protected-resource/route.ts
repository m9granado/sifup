import { PUBLIC_BASE_URL } from "@/lib/sifup-constants";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    resource: `${PUBLIC_BASE_URL}/mcp`,
    authorization_servers: [PUBLIC_BASE_URL],
  });
}
