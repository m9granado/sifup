import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { addPlayerToMatch, findPlayer, getNextMatchSummary, getPendingPayments, importWhatsAppMatch, registerMatchPayment, registerMonthlyPayment, reportMatchScore, setMatchTeams } from "@/lib/sifup-service";
import { PER_MATCH_AMOUNT, PUBLIC_BASE_URL } from "@/lib/sifup-constants";

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

async function runTool(handler: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const result = await handler();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido en la herramienta.";
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}

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
    websiteUrl: PUBLIC_BASE_URL,
    description: "MCP para gestionar partidos, listas WhatsApp y resumenes operativos de SIFUP.",
  });

  server.registerTool(
    "import_whatsapp_match",
    {
      title: "Importar lista WhatsApp",
      description: "Parsea una lista de WhatsApp y crea o REEMPLAZA por completo los jugadores de un partido (borra equipos y pagos previos). Para sumar una sola persona sin perder la lista, usa add_player_to_match.",
      inputSchema: {
        message: z.string().min(1).describe("Mensaje completo de WhatsApp."),
        matchId: z.string().optional().describe("ID del partido a actualizar. Si se omite, se busca por fecha y hora."),
        amountDue: z.number().int().positive().optional().describe(`Monto por jugador no mensual. Default: ${PER_MATCH_AMOUNT}.`),
      },
    },
    (input) => runTool(() => importWhatsAppMatch(input)),
  );

  server.registerTool(
    "find_player",
    {
      title: "Buscar jugador",
      description: "Busca jugadores existentes del club por nombre o apodo y devuelve candidatos ordenados por coincidencia (exacta, apodo, prefijo, token). Usalo para validar a que jugador corresponde un nombre de WhatsApp antes de importar la lista o agregar a alguien, y asi evitar duplicados.",
      inputSchema: {
        query: z.string().min(1).describe("Nombre o apodo a buscar."),
        limit: z.number().int().positive().max(20).optional().describe("Cantidad maxima de candidatos. Default: 5."),
      },
    },
    (input) => runTool(() => findPlayer(input)),
  );

  server.registerTool(
    "add_player_to_match",
    {
      title: "Agregar jugador al partido",
      description: "Suma un jugador al partido indicado (o al proximo si no se entrega uno) sin tocar al resto de la lista, los equipos ni los pagos. Vincula al jugador si ya existe en el club.",
      inputSchema: {
        name: z.string().min(1).describe("Nombre del jugador a agregar."),
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el proximo partido."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD del partido si no se entrega matchId."),
        phone: z.string().optional().describe("Telefono del jugador (opcional)."),
        attendanceStatus: z.enum(["confirmed", "maybe", "out", "waitlist"]).optional().describe("Estado de asistencia. Default: confirmed."),
        team: z.enum(["A", "B", "none"]).optional().describe("Equipo: A (Rojo), B (Amarillo) o none. Default: none."),
        amountDue: z.number().int().positive().optional().describe(`Monto a cobrar si no es mensual. Default: ${PER_MATCH_AMOUNT}.`),
      },
    },
    (input) => runTool(() => addPlayerToMatch(input)),
  );

  server.registerTool(
    "register_monthly_payment",
    {
      title: "Registrar pago mensual",
      description: "Marca la mensualidad (oficial) de un jugador como pagada y registra la fecha. Usar cuando alguien avisa que pago. Por defecto usa el mes actual y monto de la cuota.",
      inputSchema: {
        name: z.string().optional().describe("Nombre del jugador que pago (o usa playerId)."),
        playerId: z.string().optional().describe("ID del jugador si se conoce."),
        monthKey: z.string().optional().describe("Mes YYYY-MM. Default: mes actual."),
        paid: z.boolean().optional().describe("true para marcar pagado (default), false para revertir a pendiente."),
      },
    },
    (input) => runTool(() => registerMonthlyPayment(input)),
  );

  server.registerTool(
    "register_match_payment",
    {
      title: "Registrar pago por partido (galleta)",
      description: "Marca un pago por partido (galleta) como recibido, total o parcial. Si no se entrega matchId, busca entre los partidos del jugador el que tenga saldo pendiente mas reciente. Si no se entrega amount, salda el total pendiente de ese partido.",
      inputSchema: {
        name: z.string().optional().describe("Nombre o apodo del jugador que pago (o usa playerId)."),
        playerId: z.string().optional().describe("ID del jugador si se conoce."),
        matchId: z.string().optional().describe("ID del partido especifico. Si se omite, se busca el partido con saldo pendiente mas reciente."),
        amount: z.number().int().positive().optional().describe("Monto recibido. Default: el saldo pendiente completo de ese partido."),
      },
    },
    (input) => runTool(() => registerMatchPayment(input)),
  );

  server.registerTool(
    "get_pending_payments",
    {
      title: "Pagos pendientes",
      description: "Lista quien debe: mensualidades del mes y saldos por partido, con totales. Sirve para avisar y hacer seguimiento de cobranza.",
      inputSchema: {
        monthKey: z.string().optional().describe("Mes YYYY-MM a revisar. Default: mes actual."),
      },
    },
    (input) => runTool(() => getPendingPayments(input)),
  );

  server.registerTool(
    "set_match_teams",
    {
      title: "Asignar equipos del partido",
      description: "Actualiza los equipos Rojo y Amarillo pegando el mensaje de equipos de WhatsApp. Detecta los numeros de orden (#N) para asignar cada jugador. Util para corregir equipos despues de un import.",
      inputSchema: {
        message: z.string().min(1).describe("Mensaje de equipos de WhatsApp con formato 'Equipo Rojo:\\n- #N Nombre\\n...\\nEquipo Amarillo:\\n- #N Nombre'."),
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el mas reciente."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD del partido si no se entrega matchId."),
      },
    },
    (input) => runTool(() => setMatchTeams(input)),
  );

  server.registerTool(
    "report_match_score",
    {
      title: "Reportar resultado del partido",
      description: "Registra el marcador final (goles Rojo y Amarillo) y marca el partido como jugado. El ganador se deduce automaticamente de los goles si no se especifica.",
      inputSchema: {
        scoreA: z.number().int().min(0).describe("Goles del Equipo Rojo (A)."),
        scoreB: z.number().int().min(0).describe("Goles del Equipo Amarillo (B)."),
        winner: z.enum(["A", "B", "draw"]).optional().describe("Ganador: A (Rojo), B (Amarillo) o draw. Se deduce de los goles si se omite."),
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el partido mas reciente."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD del partido si no se entrega matchId."),
        notes: z.string().optional().describe("Notas adicionales sobre el resultado."),
      },
    },
    (input) => runTool(() => reportMatchScore(input)),
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
    (input) => runTool(() => getNextMatchSummary(input)),
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

