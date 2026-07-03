import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { getNextMatchSummary, importWhatsAppMatch } from "@/lib/sifup-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function isAuthorized(request: Request) {
  const expected = process.env.SIFUP_MCP_TOKEN;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

function createServer() {
  const server = new McpServer({
    name: "sifup",
    title: "SIFUP",
    version: "0.1.0",
    websiteUrl: "https://sifup.vercel.app",
    description: "MCP para gestionar partidos, listas WhatsApp y resumenes operativos de SIFUP.",
  });

  server.registerTool(
    "import_whatsapp_match",
    {
      title: "Importar lista WhatsApp",
      description: "Parsea una lista de WhatsApp y crea o reemplaza los jugadores de un partido SIFUP.",
      inputSchema: {
        message: z.string().min(1).describe("Mensaje completo de WhatsApp."),
        matchId: z.string().optional().describe("ID del partido a actualizar. Si se omite, se busca por fecha y hora."),
        amountDue: z.number().int().positive().optional().describe("Monto por jugador no mensual. Default: 3500."),
      },
    },
    async (input) => {
      const result = await importWhatsAppMatch(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_next_match_summary",
    {
      title: "Resumen proximo partido",
      description: "Devuelve el resumen operativo y mensajes copiables para el proximo partido o un partido especifico.",
      inputSchema: {
        matchId: z.string().optional().describe("ID del partido a consultar."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD a consultar si no se entrega matchId."),
      },
    },
    async (input) => {
      const result = await getNextMatchSummary(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  return server;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}

export async function GET() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

export async function DELETE() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

