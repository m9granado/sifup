import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { addPlayerToMatch, assignPlayerTeam, deduplicateMatchPlayers, findPlayer, generateBalancedTeams, getMatchTeams, getNextMatchSummary, getPendingPayments, getPlayerStandings, importWhatsAppMatch, mergePlayers, registerMatchPayment, registerMonthlyPayment, removePlayerFromMatch, replaceMatchTeams, setMatchResult, setMonthlyRoster, updateMatch, updateMatchPlayer } from "@/lib/sifup-service";
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
      description: "Parsea una lista de WhatsApp y actualiza los jugadores del partido. Por defecto usa modo 'merge' no destructivo (conserva equipos, pagos previos, notas manuales y la lista de 'No pueden'). Usa mode='replace' para sobreescribir desde cero.",
      inputSchema: {
        message: z.string().min(1).describe("Mensaje completo de WhatsApp."),
        matchId: z.string().optional().describe("ID del partido a actualizar. Si se omite, se busca por fecha y hora."),
        amountDue: z.number().int().positive().optional().describe(`Monto por jugador no mensual. Default: ${PER_MATCH_AMOUNT}.`),
        mode: z.enum(["merge", "replace"]).optional().describe("Modo de importación: 'merge' (default, no destructivo) o 'replace' (reemplaza por completo)."),
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
      title: "Agregar o actualizar jugador en el partido",
      description: "Suma un jugador al partido (o actualiza su fila existente sin duplicar si ya estaba en la lista). Conserva el resto de la lista, los equipos y los pagos. Por defecto: confirmed para mensuales, galleta para no mensuales.",
      inputSchema: {
        name: z.string().min(1).describe("Nombre del jugador a agregar o actualizar."),
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el proximo partido."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD del partido si no se entrega matchId."),
        phone: z.string().optional().describe("Telefono del jugador (opcional)."),
        attendanceStatus: z.enum(["confirmed", "galleta", "banca", "out", "waitlist", "maybe"]).optional().describe("Estado de asistencia: confirmed (confirmado), galleta (galleta abierta), banca (banca), out (no puede). Por defecto: confirmed para mensuales, galleta para no mensuales."),
        team: z.enum(["A", "B", "none"]).optional().describe("Equipo: A (Rojo), B (Amarillo) o none. Default: none."),
        amountDue: z.number().int().min(0).optional().describe(`Monto a cobrar si no es mensual. Default: ${PER_MATCH_AMOUNT}.`),
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
    "set_monthly_roster",
    {
      title: "Marcar fijo o galleta del mes",
      description: "Agrega o quita a un jugador del roster de fijos (mensuales) de un mes especifico, sin depender del plan por defecto del jugador. Usar para armar o corregir la renovacion mensual (quien va fijo vs galleta ese mes). Por defecto usa el mes actual.",
      inputSchema: {
        name: z.string().optional().describe("Nombre o apodo del jugador (o usa playerId)."),
        playerId: z.string().optional().describe("ID del jugador si se conoce."),
        monthKey: z.string().optional().describe("Mes YYYY-MM. Default: mes actual."),
        monthly: z.boolean().describe("true para marcarlo fijo (mensual) ese mes, false para quitarlo del roster (pasa a galleta)."),
      },
    },
    (input) => runTool(() => setMonthlyRoster(input)),
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
    "merge_players",
    {
      title: "Fusionar jugadores duplicados",
      description: "Une dos registros de jugadores (ej. un registro temporal galleta y uno oficial). Mueve todas las participaciones en partidos y pagos del jugador origen al jugador destino, y luego elimina el jugador origen.",
      inputSchema: {
        sourcePlayerId: z.string().min(1).describe("ID del jugador origen (duplicado/temporal a eliminar)."),
        targetPlayerId: z.string().min(1).describe("ID del jugador destino (oficial a conservar)."),
      },
    },
    (input) => runTool(() => mergePlayers(input)),
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

  server.registerTool(
    "get_match_teams",
    {
      title: "Ver equipos del partido",
      description: "Muestra la composicion actual de los equipos Rojo (A) y Amarillo (B) del partido, mas los jugadores sin equipo asignado. Incluye el mensaje WhatsApp copiable.",
      inputSchema: {
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el proximo partido."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD si no se entrega matchId."),
      },
    },
    (input) => runTool(() => getMatchTeams(input)),
  );

  server.registerTool(
    "assign_player_team",
    {
      title: "Mover jugador de equipo",
      description: "Cambia el equipo asignado a un jugador en el partido (Rojo=A, Amarillo=B, o sin equipo). Usa esto para ajustar manualmente la composicion de los equipos.",
      inputSchema: {
        name: z.string().optional().describe("Nombre o apodo del jugador (o usa playerId)."),
        playerId: z.string().optional().describe("ID del jugador si se conoce."),
        team: z.enum(["A", "B", "none"]).describe("Equipo destino: A (Rojo), B (Amarillo) o none (sin equipo)."),
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el proximo partido."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD si no se entrega matchId."),
      },
    },
    (input) => runTool(() => assignPlayerTeam(input)),
  );

  server.registerTool(
    "replace_match_teams",
    {
      title: "Reemplazar equipos del partido",
      description: "Reemplaza de una vez la distribución completa de Rojo y Amarillo. Primero deja a todos sin equipo y luego asigna las listas recibidas. Conserva jugadores, asistencia, pagos y orden de WhatsApp. Úsalo para corregir la formación en cancha; para mover a una sola persona también existe assign_player_team.",
      inputSchema: {
        red: z.array(z.string().min(1)).describe("Lista completa de nombres o IDs de jugadores para Rojo."),
        yellow: z.array(z.string().min(1)).describe("Lista completa de nombres o IDs de jugadores para Amarillo."),
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el próximo partido."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD si no se entrega matchId."),
      },
    },
    (input) => runTool(() => replaceMatchTeams(input)),
  );

  server.registerTool(
    "set_match_result",
    {
      title: "Registrar resultado del partido",
      description: "Guarda el marcador final del partido. El equipo ganador se determina automaticamente segun los goles (scoreA > scoreB → gana Rojo, scoreA < scoreB → gana Amarillo, iguales → empate). Genera el mensaje de resultado para WhatsApp.",
      inputSchema: {
        scoreA: z.number().int().min(0).describe("Goles del equipo Rojo (A)."),
        scoreB: z.number().int().min(0).describe("Goles del equipo Amarillo (B)."),
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el proximo partido."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD si no se entrega matchId."),
        notes: z.string().optional().describe("Notas adicionales sobre el resultado (opcional)."),
      },
    },
    (input) => runTool(() => setMatchResult(input)),
  );

  server.registerTool(
    "get_player_standings",
    {
      title: "Ranking de jugadores",
      description: "Devuelve el ranking actual de todos los jugadores con sus estadisticas (puntos, victorias, empates, derrotas, porcentaje) y un mensaje listo para copiar en WhatsApp.",
      inputSchema: {
        limit: z.number().int().positive().max(50).optional().describe("Cantidad maxima de jugadores a mostrar. Default: 20."),
        minPlayed: z.number().int().min(0).optional().describe("Minimo de partidos jugados para aparecer en el ranking. Default: 1."),
      },
    },
    (input) => runTool(() => getPlayerStandings(input)),
  );

  server.registerTool(
    "generate_balanced_teams",
    {
      title: "Generar equipos equilibrados",
      description: "Genera y guarda equipos balanceados automaticamente usando el ranking global de jugadores. Distribuye los jugadores de campo en serpentin (1→Rojo, 2→Amarillo, 3→Amarillo, 4→Rojo...) y asigna el arquero mas fuerte al equipo mas debil (en contra del jugador #1). Sobreescribe los equipos actuales.",
      inputSchema: {
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el proximo partido."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD si no se entrega matchId."),
      },
    },
    (input) => runTool(() => generateBalancedTeams(input)),
  );

  server.registerTool(
    "update_match",
    {
      title: "Actualizar datos y formato del partido",
      description: "Permite cambiar el formato del partido (clasico, rey_de_la_cancha, 7x7), cupo (squadTarget: 12, 14), notas, hora, lugar y costos. Usar para configurar formato 7x7 (14 cupos) o corregir detalles del partido.",
      inputSchema: {
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el proximo partido."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD si no se entrega matchId."),
        matchFormat: z.enum(["clasico", "rey_de_la_cancha", "7x7"]).optional().describe("Formato de juego: 'clasico' (12 cupos), '7x7' (14 cupos) o 'rey_de_la_cancha'."),
        squadTarget: z.number().int().positive().optional().describe("Cantidad objetivo de jugadores convocados (ej. 12 para clásico, 14 para 7x7)."),
        notes: z.string().optional().describe("Notas operativas del partido."),
        time: z.string().optional().describe("Hora del partido (ej. 21:00)."),
        location: z.string().optional().describe("Lugar o cancha."),
        courtCost: z.number().int().positive().optional().describe("Costo de la cancha."),
        courtPrepaid: z.boolean().optional().describe("Si la cancha ya fue pagada anticipadamente."),
      },
    },
    (input) => runTool(() => updateMatch(input)),
  );

  server.registerTool(
    "update_match_player",
    {
      title: "Editar fila de jugador en partido",
      description: "Cambia el estado de un jugador en un partido (confirmado, galleta abierta, banca, no puede), su equipo (A/B/none), montos o notas.",
      inputSchema: {
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el proximo partido."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD si no se entrega matchId."),
        name: z.string().optional().describe("Nombre o apodo del jugador a editar."),
        playerId: z.string().optional().describe("ID del jugador si se conoce."),
        matchPlayerId: z.string().optional().describe("ID de la fila en matchPlayer directamente."),
        attendanceStatus: z.enum(["confirmed", "galleta", "banca", "out", "waitlist", "maybe"]).optional().describe("Estado de asistencia: confirmed (confirmado), galleta (galleta abierta), banca (banca), out (no puede)."),
        team: z.enum(["A", "B", "none"]).optional().describe("Equipo: A (Rojo), B (Amarillo) o none."),
        amountDue: z.number().int().min(0).optional().describe("Monto a cobrar."),
        amountPaid: z.number().int().min(0).optional().describe("Monto pagado."),
        paymentStatus: z.enum(["paid", "unpaid", "promised"]).optional().describe("Estado de pago: paid, unpaid o promised."),
        note: z.string().optional().describe("Nota del jugador en este partido."),
      },
    },
    (input) => runTool(() => updateMatchPlayer(input)),
  );

  server.registerTool(
    "remove_player_from_match",
    {
      title: "Quitar jugador del partido",
      description: "Elimina completamente a un jugador de la convocatoria del partido.",
      inputSchema: {
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el proximo partido."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD si no se entrega matchId."),
        name: z.string().optional().describe("Nombre o apodo del jugador a quitar."),
        playerId: z.string().optional().describe("ID del jugador."),
        matchPlayerId: z.string().optional().describe("ID de la fila matchPlayer."),
      },
    },
    (input) => runTool(() => removePlayerFromMatch(input)),
  );

  server.registerTool(
    "deduplicate_match_players",
    {
      title: "Corregir duplicados en partido",
      description: "Detecta y fusiona filas duplicadas del mismo jugador en la convocatoria de un partido, consolidando pagos y equipos.",
      inputSchema: {
        matchId: z.string().optional().describe("ID del partido. Si se omite, se usa el proximo partido."),
        date: z.string().optional().describe("Fecha YYYY-MM-DD si no se entrega matchId."),
      },
    },
    (input) => runTool(() => deduplicateMatchPlayers(input)),
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

