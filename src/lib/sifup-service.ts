import "server-only";

import { revalidatePath } from "next/cache";
import { COURT_COST, MONTHLY_AMOUNT, PER_MATCH_AMOUNT, PUBLIC_BASE_URL } from "./sifup-constants";
import { monthKey, weekLabel } from "./sifup-date";
import { cleanPlayerName, parseWhatsAppList } from "./parser";
import { applyRosterChange as dbApplyRosterChange, deleteMonthlyPayment, getSifupData, saveMatch, saveMatchPlayers, saveMatchWithPlayers, saveMonthlyPayment, savePlayer, mergePlayers as dbMergePlayers } from "./repository";
import { isPlayerMonthlyForMonth, newId, newMatchId, newPlayerId, nextMatch, planRosterChange, playerMonthlyContext, sortByWhatsappOrder, summarizeMatch } from "./store";
import { finalResultMessage, matchSummaryMessage, pendingPaymentsMessage, standingsMessage, teamsMessage } from "./whatsapp";
import { calculateRankingRecord } from "./standings";
import { mergedReceipt, parsePaymentReceipt } from "./payment-receipt";
import { correctPaymentReceipt } from "./repository";
import type { AttendanceStatus, Match, MatchPlayer, MatchResult, MonthlyPayment, Player, Team, Winner } from "./types";

export type ImportWhatsAppMatchInput = {
  message: string;
  matchId?: string;
  amountDue?: number;
  mode?: "merge" | "replace";
};

export async function importWhatsAppMatch({
  message,
  matchId,
  amountDue = PER_MATCH_AMOUNT,
  mode = "merge",
}: ImportWhatsAppMatchInput) {
  const parsed = parseWhatsAppList(message, amountDue);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.join(" "));
  }

  const data = await getSifupData();
  const existing = matchId
    ? data.matches.find((match) => match.id === matchId)
    : data.matches.find((match) => match.date === parsed.match.date && match.time === parsed.match.time);
  const now = new Date().toISOString();
  const targetId = existing?.id ?? newMatchId(parsed.match.date, data.matches.map((match) => match.id));

  const matchFormat = parsed.match.matchFormat ?? existing?.matchFormat ?? "clasico";
  const squadTarget = parsed.match.squadTarget ?? existing?.squadTarget ?? (matchFormat === "7x7" ? 14 : 12);

  // Modo no destructivo: no pisar notas manuales con placeholder por defecto
  const existingNotes = existing?.notes?.trim() ?? "";
  const isDefaultNote = existingNotes === "Importado desde WhatsApp." || existingNotes === "Importado desde WhatsApp por MCP.";
  const preservedNotes = existingNotes && !isDefaultNote ? existingNotes : "Importado desde WhatsApp por MCP.";

  const match: Match = {
    id: targetId,
    date: parsed.match.date,
    time: parsed.match.time,
    location: existing?.location || parsed.match.location || "Por definir",
    status: existing?.status ?? "confirmed",
    totalCost: existing?.totalCost ?? COURT_COST,
    weekLabel: existing?.weekLabel || weekLabel(parsed.match.date),
    // Always derive from `date`, never trust a possibly-stale existing.monthKey.
    monthKey: monthKey(parsed.match.date),
    courtCost: existing?.courtCost ?? COURT_COST,
    courtPrepaid: existing?.courtPrepaid ?? true,
    notes: preservedNotes,
    matchFormat,
    squadTarget,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const existingRows = data.matchPlayers.filter((row) => row.matchId === targetId);
  const knownPlayers = [...data.players];
  const rows: MatchPlayer[] = [];
  const addedPlayerIds = new Set<string>();
  const addedNames = new Set<string>();
  const ambiguities: string[] = [];

  for (const [index, row] of parsed.players.entries()) {
    const out = row.attendanceStatus === "out";

    // 1. Limpieza de emojis y búsqueda unificada
    const matchResult = resolvePlayerMatch(knownPlayers, row.name, data.matchPlayers);
    let player = matchResult.player;

    if (matchResult.isAmbiguous) {
      ambiguities.push(
        `Ambigüedad con '${row.name}': coincide con ${matchResult.candidates.map((c) => c.player.name).join(", ")}. Por favor verifica el jugador.`,
      );
    }

    if (!player && !out && !matchResult.isAmbiguous) {
      const cleanName = cleanPlayerName(row.name);
      const newPlayer: Player = {
        id: newPlayerId(cleanName, knownPlayers.map((item) => item.id)),
        name: cleanName,
        nickname: cleanName.split(" ")[0],
        phone: row.phone,
        paymentPlan: "perMatch",
        skillLevel: 3,
        active: true,
        shortName: cleanName.slice(0, 3).toUpperCase(),
        isGoalkeeper: false,
        createdAt: now,
        updatedAt: now,
      };
      await savePlayer(newPlayer);
      knownPlayers.push(newPlayer);
      player = newPlayer;
    }

    // Prevención de duplicados en el mismo partido (caso "Marcelo" -> Marcelo Calderon duplicado)
    const normRowName = normalizeName(player?.name ?? row.name);
    if ((player && addedPlayerIds.has(player.id)) || addedNames.has(normRowName)) {
      continue;
    }
    if (player) addedPlayerIds.add(player.id);
    addedNames.add(normRowName);

    // Modo no destructivo (merge): preservar equipos y pagos previos si existen
    const existingRow = mode === "merge"
      ? existingRows.find((er) => (player && er.playerId === player.id) || normalizeName(er.name) === normRowName)
      : undefined;

    const monthly = player ? isPlayerMonthlyForMonth(player.id, match.monthKey, data.players, data.monthlyPayments) : false;

    let paymentStatus = out || monthly ? ("paid" as const) : row.paymentStatus;
    let amountDue = out || monthly ? 0 : row.amountDue;
    let amountPaid = out || monthly ? 0 : row.amountPaid;
    let team = out ? ("none" as const) : row.team;
    let note = out ? "No puede" : monthly && !row.note ? "mensualidad" : row.note;

    if (existingRow && mode === "merge") {
      if (existingRow.team !== "none" && team === "none") {
        team = existingRow.team;
      }
      // Solo se preserva el monto si hubo un pago real: "paid" con amountPaid=0 es
      // el estado trivial de una fila mensual/gratis, y si el jugador ya no es
      // mensual ese $0 quedaria pegado para siempre (bug real: ver German 09-15).
      // amountPaid real siempre se conserva; amountDue/paymentStatus solo se heredan
      // de la fila existente si no es out/monthly (que deben seguir en 0/paid).
      if (existingRow.amountPaid > 0) {
        amountPaid = existingRow.amountPaid;
        if (!out && !monthly) {
          paymentStatus = existingRow.paymentStatus;
          amountDue = existingRow.amountDue;
        }
      }
      if (existingRow.note && !note) {
        note = existingRow.note;
      }
    }

    rows.push({
      ...row,
      id: existingRow?.id ?? `${targetId}-player-${index + 1}`,
      matchId: targetId,
      playerId: player?.id,
      name: player?.name ?? row.name,
      phone: player?.phone ?? row.phone,
      paymentStatus,
      amountDue,
      amountPaid,
      paidAt: existingRow?.paidAt,
      paidDate: existingRow?.paidDate,
      note,
      team,
      teamId: existingRow?.teamId,
      whatsappOrder: row.whatsappOrder || index + 1,
      createdAt: existingRow?.createdAt ?? now,
      updatedAt: now,
    });
  }

  // En modo merge, conservar también jugadores existentes en "No pueden" que no vengan en el mensaje
  if (mode === "merge") {
    for (const exRow of existingRows) {
      if (exRow.attendanceStatus === "out") {
        const norm = normalizeName(exRow.name);
        if (!addedNames.has(norm) && (!exRow.playerId || !addedPlayerIds.has(exRow.playerId))) {
          rows.push({
            ...exRow,
            updatedAt: now,
          });
          if (exRow.playerId) addedPlayerIds.add(exRow.playerId);
          addedNames.add(norm);
        }
      }
    }
  }

  // The configured squad size is authoritative even when the WhatsApp
  // message labels every row as "official". Overflow is retained as banca.
  let officialCount = 0;
  for (const row of rows) {
    if (row.attendanceStatus !== "confirmed") continue;
    officialCount += 1;
    if (officialCount > squadTarget) {
      row.attendanceStatus = "banca";
      row.note = "Banca";
      row.team = "none";
    }
  }

  await saveMatchWithPlayers(match, rows);
  revalidateSifupViews(match.id);

  const payload = buildMatchPayload(match, rows, data.results.find((result) => result.matchId === match.id), existing ? "updated" : "created", data.players, data.monthlyPayments);
  return {
    ...payload,
    ambiguities: ambiguities.length > 0 ? ambiguities : undefined,
  };
}

export async function getNextMatchSummary(input: { matchId?: string; date?: string } = {}) {
  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);

  if (!match) throw new Error("No hay partidos registrados.");

  const rows = sortByWhatsappOrder(data.matchPlayers.filter((row) => row.matchId === match.id));
  const result = data.results.find((item) => item.matchId === match.id);
  return buildMatchPayload(match, rows, result, "summary", data.players, data.monthlyPayments);
}

// Mirrors zod's number().int() validation (rejects NaN/Infinity/fractions/>MAX_SAFE_INTEGER).
function assertValidAmount(value: number | undefined, label: string) {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} invalido: debe ser un entero mayor o igual a 0 (recibido ${value}).`);
  }
}

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertValidMonthKey(value: string) {
  if (!MONTH_KEY_RE.test(value)) {
    throw new Error(`Mes invalido: '${value}'. Formato esperado YYYY-MM (01-12).`);
  }
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type AddPlayerToMatchInput = {
  name: string;
  matchId?: string;
  date?: string;
  phone?: string;
  attendanceStatus?: AttendanceStatus;
  team?: Team;
  amountDue?: number;
  provisionalGuest?: boolean;
};

export async function addPlayerToMatch(input: AddPlayerToMatchInput) {
  const cleanName = cleanPlayerName(input.name ?? "");
  if (!cleanName) throw new Error("Falta el nombre del jugador.");
  assertValidAmount(input.amountDue, "amountDue");

  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);
  if (!match) throw new Error("No hay partido para actualizar.");

  const currentRows = data.matchPlayers.filter((row) => row.matchId === match.id);
  const result = data.results.find((item) => item.matchId === match.id);
  const players = [...data.players];

  let known: Player | undefined;
  let already: MatchPlayer | undefined;

  if (input.provisionalGuest) {
    if (input.attendanceStatus === "confirmed") {
      throw new Error("No se permite attendanceStatus 'confirmed' para un invitado provisional.");
    }

    const normTarget = normalizeName(cleanName);

    // 1. Resolver nombre exacto únicamente en este modo, nunca findKnownPlayer.
    const matchingPlayers = players.filter((p) => normalizeName(p.name) === normTarget);
    if (matchingPlayers.length > 1) {
      throw new Error(`Ambigüedad: existen múltiples jugadores con el nombre exacto '${cleanName}'.`);
    }

    const exactPlayer = matchingPlayers[0];
    if (exactPlayer) {
      if (exactPlayer.paymentPlan !== "perMatch") {
        throw new Error(`Colisión incompatible: el jugador '${exactPlayer.name}' no tiene plan por partido.`);
      }
      // Rechaza known con perMatch global pero mensual EFECTIVO según roster
      const isMonthlyEffective = isPlayerMonthlyForMonth(exactPlayer.id, match.monthKey, players, data.monthlyPayments);
      if (isMonthlyEffective) {
        throw new Error(`Colisión incompatible: el jugador '${exactPlayer.name}' está en el roster mensual del mes.`);
      }
    }

    // 2. Detectar colisión exacta en las filas del partido antes de persistir
    const matchingRows = currentRows.filter(
      (row) => normalizeName(row.name) === normTarget || (exactPlayer && row.playerId === exactPlayer.id),
    );

    if (matchingRows.length > 1) {
      throw new Error(`Ambigüedad: existen múltiples filas en el partido que coinciden con '${cleanName}'.`);
    }

    const existingRow = matchingRows[0];
    if (existingRow) {
      // Coincidencia en row por nombre exacto debe estar ligada al invitado propio;
      // si nombre exacto liga Cooper/Hans (o a otro jugador distinto) hay colisión -> error sin escrituras.
      if (existingRow.playerId && (!exactPlayer || existingRow.playerId !== exactPlayer.id)) {
        throw new Error(`Colisión en el partido: la fila '${existingRow.name}' está ligada a otro jugador (${existingRow.playerId}).`);
      }

      // NO demuevas participantes ya confirmados por cierre al repetir. Incompatibilidad de estado se rechaza antes de guardar.
      if (existingRow.attendanceStatus === "confirmed" && input.attendanceStatus !== undefined) {
        throw new Error("No se puede cambiar el estado de un participante ya confirmado por cierre.");
      }
    }

    // 3. Crear o reusar jugador PROPIO con nombre exacto normalizado y plan perMatch mediante savePlayer.
    const now = new Date().toISOString();
    if (exactPlayer) {
      known = exactPlayer;
    } else {
      const newPlayer: Player = {
        id: newPlayerId(cleanName, players.map((item) => item.id)),
        name: cleanName,
        nickname: cleanName.split(" ")[0],
        phone: input.phone ?? "",
        paymentPlan: "perMatch",
        skillLevel: 3,
        active: true,
        shortName: cleanName.slice(0, 3).toUpperCase(),
        isGoalkeeper: false,
        createdAt: now,
        updatedAt: now,
      };
      await savePlayer(newPlayer);
      players.push(newPlayer);
      known = newPlayer;
    }

    already = existingRow;
  } else {
    // NOTA DE SEGURIDAD / COMPATIBILIDAD:
    // El flujo legacy a continuación utiliza findKnownPlayer (coincidencia difusa/fuzzy).
    // Esto es inseguro para nombres de invitados provisionales que contengan nombres o apodos
    // de jugadores existentes (por ejemplo, "H galleta cooper" asocia con score 65 a "Cooper").
    // Por diseño, no se afloja findKnownPlayer globalmente ni se altera la heurística de matching;
    // para altas e importaciones provisionales se debe usar la vía explícita provisionalGuest: true.
    known = findKnownPlayer(players, cleanName, data.matchPlayers);
    already = currentRows.find(
      (row) => (known && row.playerId === known.id) || normalizeName(row.name) === normalizeName(cleanName),
    );
  }

  const monthlyPlayerId = known?.id ?? already?.playerId;
  const monthly = input.provisionalGuest
    ? false
    : monthlyPlayerId
      ? isPlayerMonthlyForMonth(monthlyPlayerId, match.monthKey, players, data.monthlyPayments)
      : false;

  // Si ya existe en el partido, ACTUALIZAR la fila existente sin duplicar (Scope 4)
  if (already) {
    const now = new Date().toISOString();
    const newStatus = input.attendanceStatus ?? already.attendanceStatus;
    // Mirrors updateMatchPlayer's "out"/repricing handling so both tools produce the same row shape.
    const isOut = newStatus === "out";
    const shouldRepriceGalleta = !input.provisionalGuest && !isOut && newStatus === "confirmed" && !monthly && input.amountDue === undefined && already.amountDue === 0;
    const amountDue = isOut || monthly ? 0 : input.amountDue !== undefined ? input.amountDue : shouldRepriceGalleta ? PER_MATCH_AMOUNT : already.amountDue;
    const amountPaid = already.amountPaid;
    const updatedRow: MatchPlayer = {
      ...already,
      playerId: input.provisionalGuest && !already.playerId ? known?.id : already.playerId,
      name: input.provisionalGuest ? cleanName : already.name,
      phone: input.phone ?? already.phone,
      attendanceStatus: newStatus,
      team: isOut ? "none" : input.team ?? already.team,
      amountDue,
      amountPaid,
      paymentStatus: isOut || monthly
        ? "paid"
        : shouldRepriceGalleta
          ? (amountPaid >= amountDue ? "paid" : "unpaid")
          : (amountPaid >= amountDue ? "paid" : already.paymentStatus),
      note: isOut ? "No puede" : already.note,
      updatedAt: now,
    };
    const nextRows = currentRows.map((r) => (r.id === already.id ? updatedRow : r));
    await saveMatchPlayers(match.id, nextRows);
    revalidateSifupViews(match.id);
    const payload = buildMatchPayload(match, nextRows, result, "updated", players, data.monthlyPayments);
    return { ...payload, note: `${already.name} ya estaba en la lista del partido y fue actualizado.` };
  }

  // Criterio Scope 4: Por defecto confirmed para mensuales, galleta para no mensuales
  const attendanceStatus = input.attendanceStatus ?? (monthly ? "confirmed" : "galleta");
  const out = attendanceStatus === "out";
  const amountDue = input.amountDue ?? (out || monthly ? 0 : PER_MATCH_AMOUNT);
  const now = new Date().toISOString();
  const newRow: MatchPlayer = {
    id: newId("mp"),
    matchId: match.id,
    playerId: known?.id,
    name: input.provisionalGuest ? cleanName : (known?.name ?? cleanName),
    phone: input.phone ?? known?.phone ?? "",
    attendanceStatus,
    paymentStatus: out || monthly ? "paid" : (amountDue === 0 ? "paid" : "unpaid"),
    amountDue: out || monthly ? 0 : amountDue,
    amountPaid: 0,
    note: out ? "No puede" : monthly ? "mensualidad" : attendanceStatus === "galleta" ? "Galleta abierta" : attendanceStatus === "waitlist" ? "En lista de espera" : "",
    team: out ? "none" : input.team ?? "none",
    whatsappOrder: Math.max(0, ...currentRows.map((row) => row.whatsappOrder || 0)) + 1,
    goals: 0,
    createdAt: now,
    updatedAt: now,
  };

  const nextRows = [...currentRows, newRow];
  await saveMatchPlayers(match.id, nextRows);
  revalidateSifupViews(match.id);

  const payload = buildMatchPayload(match, nextRows, result, "updated", players, data.monthlyPayments);
  return { ...payload, note: `${newRow.name} agregado al partido en el puesto #${newRow.whatsappOrder}.` };
}

// An explicit matchId/date that doesn't resolve must not silently fall back to
// the next match. monthKey is normalized from `date`, never trusted as stored,
// so a desynced value can't make isPlayerMonthlyForMonth read the wrong month.
function resolveMatch(matches: Match[], input: { matchId?: string; date?: string }): Match | undefined {
  const match = input.matchId !== undefined
    ? matches.find((item) => item.id === input.matchId)
    : input.date !== undefined
      ? matches.find((item) => item.date === input.date)
      : nextMatch(matches);
  return match ? { ...match, monthKey: monthKey(match.date) } : undefined;
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export type RegisterMonthlyPaymentInput = {
  name?: string;
  playerId?: string;
  monthKey?: string;
  paid?: boolean;
  receivedAt?: string;
};

export async function registerMonthlyPayment(input: RegisterMonthlyPaymentInput) {
  const receipt = input.receivedAt !== undefined ? parsePaymentReceipt(input.receivedAt) : undefined;
  if (receipt && input.paid === false) throw new Error("No se puede fechar una promesa o un pago pendiente.");
  const data = await getSifupData();
  const player = input.playerId
    ? data.players.find((item) => item.id === input.playerId)
    : input.name
      ? findKnownPlayer(data.players, input.name)
      : undefined;
  if (!player) throw new Error("Jugador no encontrado.");
  const targetMonth = input.monthKey ?? currentMonthKey();
  assertValidMonthKey(targetMonth);
  if (!isPlayerMonthlyForMonth(player.id, targetMonth, data.players, data.monthlyPayments)) throw new Error(`${player.name} no es jugador mensual (oficial) en ${targetMonth}.`);

  const paid = input.paid ?? true;
  const existing = data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === targetMonth);
  const expected = existing?.expectedAmount ?? MONTHLY_AMOUNT;
  const now = new Date().toISOString();
  const payment: MonthlyPayment = {
    id: existing?.id ?? `monthly-${targetMonth}-${player.id}`,
    playerId: player.id,
    monthKey: targetMonth,
    expectedAmount: expected,
    amountPaid: paid ? expected : 0,
    paymentStatus: paid ? "paid" : "unpaid",
    note: existing?.note ?? `Mensualidad ${targetMonth}, vencimiento 10/${targetMonth.slice(5)}`,
    paidAt: receipt ? receipt.paidAt : existing?.paidAt ?? (paid && !(existing?.amountPaid) && !existing?.paidDate ? now : undefined),
    paidDate: receipt ? receipt.paidDate : existing?.paidDate,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await saveMonthlyPayment(payment, receipt !== undefined);
  revalidateSifupViews();

  return {
    status: paid ? "paid" : "unpaid",
    player: player.name,
    monthKey: targetMonth,
    expectedAmount: expected,
    amountPaid: payment.amountPaid,
    paidAt: payment.paidAt ?? null,
    paidDate: payment.paidDate ?? null,
    note: paid
      ? `${player.name} pago la mensualidad de ${targetMonth}.`
      : `Se marco pendiente la mensualidad de ${player.name} para ${targetMonth}.`,
  };
}

export type SetMonthlyRosterInput = {
  name?: string;
  playerId?: string;
  monthKey?: string;
  monthly: boolean;
  cancelGalletas?: boolean;
};

export async function setMonthlyRoster(input: SetMonthlyRosterInput) {
  const data = await getSifupData();
  const player = input.playerId
    ? data.players.find((item) => item.id === input.playerId)
    : input.name
      ? findKnownPlayer(data.players, input.name)
      : undefined;
  if (!player) throw new Error("Jugador no encontrado.");

  const targetMonth = input.monthKey ?? currentMonthKey();
  assertValidMonthKey(targetMonth);
  const existing = data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === targetMonth);
  const playerRows = data.matchPlayers.filter((row) => row.playerId === player.id || findKnownPlayer(data.players, row.name)?.id === player.id);
  const plan = planRosterChange({ playerRows, matches: data.matches, monthKey: targetMonth, monthly: input.monthly, payment: existing, cancelGalletas: input.cancelGalletas ?? false });

  if (input.monthly) {
    const now = new Date().toISOString();
    const upsertPayment: MonthlyPayment | undefined = existing
      ? undefined
      : {
          id: `monthly-${targetMonth}-${player.id}`,
          playerId: player.id,
          monthKey: targetMonth,
          expectedAmount: MONTHLY_AMOUNT,
          amountPaid: 0,
          paymentStatus: "unpaid",
          note: `Mensualidad ${targetMonth}, vencimiento 10/${targetMonth.slice(5)}`,
          createdAt: now,
          updatedAt: now,
        };
    if (!upsertPayment && plan.rowUpdates.length === 0) {
      return { status: "unchanged", player: player.name, monthKey: targetMonth, ...rosterWarnings(plan, true), note: `${player.name} ya estaba como fijo en ${targetMonth}.` };
    }
    await dbApplyRosterChange({ playerId: player.id, monthKey: targetMonth, upsertPayment, rowUpdates: plan.rowUpdates });
    revalidateSifupViews();
    return { status: upsertPayment ? "added" : "galletas_cancelled", player: player.name, monthKey: targetMonth, ...rosterWarnings(plan, true), note: `${player.name} agregado como fijo (mensual) en ${targetMonth}.` };
  }

  if (!existing) {
    return { status: "unchanged", player: player.name, monthKey: targetMonth, note: `${player.name} ya era galleta en ${targetMonth}.` };
  }
  await dbApplyRosterChange({ playerId: player.id, monthKey: targetMonth, deletePayment: true, rowUpdates: plan.rowUpdates });
  revalidateSifupViews();
  return { status: "removed", player: player.name, monthKey: targetMonth, ...rosterWarnings(plan, false), note: `${player.name} pasa a galleta en ${targetMonth}.` };
}

function rosterWarnings(plan: ReturnType<typeof planRosterChange>, toMonthly: boolean) {
  return toMonthly
    ? { unpaidGalletaCount: plan.unpaidGalletaCount, unpaidGalletaAmount: plan.unpaidGalletaAmount, galletasCancelled: plan.rowUpdates.length, paidGalletaAmount: plan.paidGalletaAmount }
    : { repricedToGalleta: plan.repricedCount, discardedPaidMonthlyAmount: plan.paidMonthlyAmount };
}

export type RegisterMatchPaymentInput = {
  name?: string;
  playerId?: string;
  matchId?: string;
  amount?: number;
  receivedAt?: string;
};

export async function registerMatchPayment(input: RegisterMatchPaymentInput) {
  assertValidAmount(input.amount, "amount");
  if (input.amount === 0) throw new Error("El abono debe ser positivo; para corregir fechas usa correct_payment_received_at.");
  const receipt = input.receivedAt !== undefined ? parsePaymentReceipt(input.receivedAt) : undefined;
  const data = await getSifupData();
  const player = input.playerId
    ? data.players.find((item) => item.id === input.playerId)
    : input.name
      ? findKnownPlayer(data.players, input.name)
      : undefined;

  const target = normalizeName(input.name ?? "");
  const candidates = data.matchPlayers.filter((row) => {
    if (input.matchId && row.matchId !== input.matchId) return false;
    if (player) return row.playerId === player.id;
    return target.length > 0 && normalizeName(row.name) === target;
  });

  if (candidates.length === 0) throw new Error("No se encontro al jugador en ningun partido.");
  if (input.matchId && candidates.length !== 1) throw new Error("Hay filas duplicadas; resolver antes de registrar un pago.");

  const row = input.matchId
    ? candidates[0]
    : candidates
        .filter((item) => item.amountDue > item.amountPaid)
        .sort((a, b) => {
          const matchA = data.matches.find((item) => item.id === a.matchId);
          const matchB = data.matches.find((item) => item.id === b.matchId);
          return (matchB?.date ?? "").localeCompare(matchA?.date ?? "");
        })[0];

  if (!row) throw new Error(`${input.name ?? player?.name ?? "El jugador"} no tiene saldo pendiente por partido.`);

  const match = data.matches.find((item) => item.id === row.matchId);
  const amount = input.amount ?? Math.max(row.amountDue - row.amountPaid, 0);
  const now = new Date().toISOString();
  const updatedAmountPaid = Math.max(row.amountPaid, Math.min(row.amountDue, row.amountPaid + amount));
  const receivedAmount = Math.max(updatedAmountPaid - row.amountPaid, 0);
  if (receipt && receivedAmount === 0) throw new Error("Pago ya registrado: usa correct_payment_received_at para corregir solo la fecha.");
  const updatedRow: MatchPlayer = {
    ...row,
    amountPaid: updatedAmountPaid,
    paidAt: receipt ? receipt.paidAt : row.paidAt ?? (receivedAmount > 0 && !row.paidDate ? now : undefined),
    paidDate: receipt ? receipt.paidDate : row.paidDate,
    paymentStatus: updatedAmountPaid >= row.amountDue ? "paid" : row.paymentStatus,
    updatedAt: now,
  };

  const matchRows = data.matchPlayers.filter((item) => item.matchId === row.matchId).map((item) => (item.id === row.id ? updatedRow : item));
  await saveMatchPlayers(row.matchId, matchRows);
  revalidateSifupViews(row.matchId);

  return {
    player: row.name,
    match: match?.weekLabel || match?.date || row.matchId,
    matchId: row.matchId,
    amountPaid: updatedRow.amountPaid,
    amountDue: updatedRow.amountDue,
    pending: Math.max(updatedRow.amountDue - updatedRow.amountPaid, 0),
    status: updatedRow.paymentStatus,
    paidAt: updatedRow.paidAt ?? null,
    paidDate: updatedRow.paidDate ?? null,
    note: `${row.name} pago ${receivedAmount} para el partido ${match?.weekLabel || match?.date}. Saldo pendiente: ${Math.max(updatedRow.amountDue - updatedRow.amountPaid, 0)}.`,
  };
}

export type PaymentRecordInput = { playerId: string; monthKey?: string; matchId?: string };

function resolvePaymentRecord(data: Awaited<ReturnType<typeof getSifupData>>, input: PaymentRecordInput) {
  if (!input.playerId || (input.monthKey !== undefined) === (input.matchId !== undefined)) {
    throw new Error("Usa playerId y exactamente uno de monthKey o matchId.");
  }
  if (!data.players.some((player) => player.id === input.playerId)) throw new Error("Jugador no encontrado.");
  if (input.monthKey !== undefined) {
    assertValidMonthKey(input.monthKey);
    const payment = data.monthlyPayments.find((row) => row.playerId === input.playerId && row.monthKey === input.monthKey);
    if (!payment) throw new Error("Mensualidad no registrada.");
    return { kind: "monthly" as const, payment };
  }
  const rows = data.matchPlayers.filter((row) => row.playerId === input.playerId && row.matchId === input.matchId);
  if (rows.length !== 1) throw new Error("Se requiere una unica fila de jugador en ese partido.");
  return { kind: "perMatch" as const, payment: rows[0] };
}

export async function getPaymentRecord(input: PaymentRecordInput) {
  const { kind, payment } = resolvePaymentRecord(await getSifupData(), input);
  return {
    kind, id: payment.id, playerId: payment.playerId,
    monthKey: kind === "monthly" ? (payment as MonthlyPayment).monthKey : null,
    matchId: kind === "perMatch" ? (payment as MatchPlayer).matchId : null,
    amountDue: kind === "monthly" ? (payment as MonthlyPayment).expectedAmount : (payment as MatchPlayer).amountDue,
    amountPaid: payment.amountPaid, paymentStatus: payment.paymentStatus,
    paidDate: payment.paidDate ?? null, paidAt: payment.paidAt ?? null,
    receiptPrecision: payment.paidAt ? "instant" : payment.paidDate ? "date" : "unknown",
    timeZone: payment.paidAt ? "UTC" : null,
    createdAt: payment.createdAt, updatedAt: payment.updatedAt,
  };
}

export async function correctPaymentReceivedAt(input: PaymentRecordInput & { receivedAt: string }) {
  parsePaymentReceipt(input.receivedAt);
  const { kind, payment } = resolvePaymentRecord(await getSifupData(), input);
  if (payment.amountPaid <= 0) throw new Error("Una promesa o deuda no es un pago recibido.");
  await correctPaymentReceipt(kind, payment.id, input.receivedAt);
  revalidateSifupViews(input.matchId);
  return getPaymentRecord(input);
}

export async function getPendingPayments(input: { monthKey?: string } = {}) {
  const data = await getSifupData();
  const targetMonth = input.monthKey ?? currentMonthKey();

  const monthlyPending = data.players
    .filter((player) => player.active && isPlayerMonthlyForMonth(player.id, targetMonth, data.players, data.monthlyPayments))
    .map((player) => {
      const payment = data.monthlyPayments.find((item) => item.playerId === player.id && item.monthKey === targetMonth);
      const expected = payment?.expectedAmount ?? MONTHLY_AMOUNT;
      const amountPaid = payment?.paymentStatus === "paid" ? expected : payment?.amountPaid ?? 0;
      return { player: player.name, monthKey: targetMonth, expected, pending: Math.max(expected - amountPaid, 0), status: payment?.paymentStatus ?? "unpaid" };
    })
    .filter((item) => item.pending > 0);

  const perMatchPending = data.matchPlayers
    .filter((row) => row.amountDue > row.amountPaid)
    .map((row) => {
      const match = data.matches.find((item) => item.id === row.matchId);
      return { player: row.name, match: match?.weekLabel || match?.date || row.matchId, matchId: row.matchId, pending: Math.max(row.amountDue - row.amountPaid, 0), status: row.paymentStatus };
    });

  return {
    monthKey: targetMonth,
    totals: {
      monthly: monthlyPending.reduce((sum, item) => sum + item.pending, 0),
      perMatch: perMatchPending.reduce((sum, item) => sum + item.pending, 0),
    },
    monthlyPending,
    perMatchPending,
  };
}

function buildMatchPayload(match: Match, rows: MatchPlayer[], result: Parameters<typeof finalResultMessage>[1], status: "created" | "updated" | "summary" | "unchanged", players: Player[], monthlyPayments: MonthlyPayment[]) {
  const sortedRows = sortByWhatsappOrder(rows);
  const summary = summarizeMatch(sortedRows);
  const confirmed = sortedRows.filter((row) => row.attendanceStatus === "confirmed");
  const out = sortedRows.filter((row) => row.attendanceStatus === "out");

  return {
    status,
    match,
    summary,
    players: {
      confirmed: confirmed.map((row) => withEffectivePlan(row, players, monthlyPayments, match.monthKey)),
      out: out.map((row) => withEffectivePlan(row, players, monthlyPayments, match.monthKey)),
      all: sortedRows.map((row) => withEffectivePlan(row, players, monthlyPayments, match.monthKey)),
    },
    messages: {
      matchSummary: matchSummaryMessage(match, sortedRows, players, monthlyPayments),
      pendingPayments: pendingPaymentsMessage(match, sortedRows),
      teams: teamsMessage(match, sortedRows),
      finalResult: finalResultMessage(match, result),
    },
    url: `${PUBLIC_BASE_URL}/matches/${match.id}`,
  };
}

function publicMatchPlayer(row: MatchPlayer) {
  return {
    id: row.id,
    name: row.name,
    attendanceStatus: row.attendanceStatus,
    paymentStatus: row.paymentStatus,
    amountDue: row.amountDue,
    amountPaid: row.amountPaid,
    paidAt: row.paidAt ?? null,
    paidDate: row.paidDate ?? null,
    note: row.note,
    team: row.team,
    whatsappOrder: row.whatsappOrder,
  };
}

// Resolves the same way whatsapp.ts's isMonthlyRow does: id match, then exact
// name match. Never fuzzy — an unresolved row stays undefined/perMatch.
function withEffectivePlan(row: MatchPlayer, players: Player[], monthlyPayments: MonthlyPayment[], matchMonthKey: string) {
  const base = publicMatchPlayer(row);
  const player = players.find((item) => item.id === row.playerId) ?? players.find((item) => item.name.toLowerCase() === row.name.toLowerCase());
  if (!player) return { ...base, effectivePaymentPlan: undefined as "monthly" | "perMatch" | undefined };
  const context = playerMonthlyContext(player.id, matchMonthKey, players, monthlyPayments);
  return { ...base, effectivePaymentPlan: (context.isMonthly ? "monthly" : "perMatch") as "monthly" | "perMatch" };
}

export type FindPlayerInput = {
  query: string;
  limit?: number;
  // Optional context to resolve the effective monthly status (matchId > date >
  // monthKey priority; defaults to the current month).
  matchId?: string;
  date?: string;
  monthKey?: string;
};

type EffectiveMonthContext = { monthKey: string; matchId?: string; date?: string };

// Mirrors resolveMatch's strictness: an unknown matchId/date throws, and
// monthKey is always derived from `date`, never trusted as stored.
function resolveEffectiveMonthContext(input: { matchId?: string; date?: string; monthKey?: string }, data: { matches: Match[] }): EffectiveMonthContext {
  if (input.matchId !== undefined) {
    const match = data.matches.find((item) => item.id === input.matchId);
    if (!match) throw new Error(`No existe un partido con matchId '${input.matchId}'.`);
    return { monthKey: monthKey(match.date), matchId: match.id, date: match.date };
  }
  if (input.date !== undefined) {
    if (!isValidIsoDate(input.date)) throw new Error(`Fecha invalida: '${input.date}'. Formato esperado YYYY-MM-DD.`);
    const match = data.matches.find((item) => item.date === input.date);
    return { monthKey: monthKey(input.date), matchId: match?.id, date: input.date };
  }
  if (input.monthKey !== undefined) {
    assertValidMonthKey(input.monthKey);
    return { monthKey: input.monthKey };
  }
  return { monthKey: currentMonthKey() };
}

export async function findPlayer({ query, limit = 5, matchId, date, monthKey: monthKeyInput }: FindPlayerInput) {
  const data = await getSifupData();
  const candidates = rankPlayerCandidates(data.players, query).slice(0, limit);
  const context = resolveEffectiveMonthContext({ matchId, date, monthKey: monthKeyInput }, data);

  return {
    query,
    effectiveContext: context,
    matches: candidates.map(({ player, matchType, score }) => {
      const monthlyContext = playerMonthlyContext(player.id, context.monthKey, data.players, data.monthlyPayments);
      return {
        id: player.id,
        name: player.name,
        nickname: player.nickname,
        active: player.active,
        paymentPlan: player.paymentPlan,
        effectivePaymentPlan: (monthlyContext.isMonthly ? "monthly" : "perMatch") as "monthly" | "perMatch",
        effectiveSource: monthlyContext.source,
        skillLevel: player.skillLevel,
        matchType,
        score,
      };
    }),
  };
}

type PlayerMatchType = "exact" | "prefix" | "nickname" | "contains" | "nickname-contains" | "token";

function rankPlayerCandidates(players: Player[], name: string) {
  const target = normalizeName(name);
  const ranked: { player: Player; matchType: PlayerMatchType; score: number }[] = [];

  for (const player of players) {
    const match = scorePlayerMatch(player, target);
    if (match) ranked.push({ player, ...match });
  }

  return ranked.sort((a, b) => b.score - a.score);
}

function scorePlayerMatch(player: Player, target: string): { matchType: PlayerMatchType; score: number } | null {
  const playerName = normalizeName(player.name);
  const nickname = normalizeName(player.nickname);

  // Normalize aliases for Piti / Pituto / Cristopher
  const pitiAliases = ["piti", "pituto", "cristopher"];
  if (pitiAliases.includes(target) && (pitiAliases.includes(playerName) || pitiAliases.includes(nickname))) {
    return { matchType: "exact", score: 100 };
  }

  if (target === playerName || (nickname && target === nickname)) return { matchType: "exact", score: 100 };

  if (target.length >= 3 && (playerName.startsWith(target) || target.startsWith(playerName))) {
    return { matchType: "prefix", score: 85 };
  }

  if (nickname && target.length >= 2 && (nickname.startsWith(target) || target.startsWith(nickname))) {
    return { matchType: "nickname", score: 80 };
  }

  if (playerName.includes(target) || target.includes(playerName)) {
    return { matchType: "contains", score: 65 };
  }

  if (nickname && (nickname.includes(target) || target.includes(nickname))) {
    return { matchType: "nickname-contains", score: 60 };
  }

  const targetTokens = new Set(target.split(" ").filter(Boolean));
  const overlap = playerName.split(" ").filter((token) => token && targetTokens.has(token)).length;
  if (overlap > 0) return { matchType: "token", score: 40 + overlap * 10 };

  return null;
}

export type PlayerMatchResult = {
  player?: Player;
  candidates: { player: Player; matchType: PlayerMatchType; score: number }[];
  isAmbiguous: boolean;
};

export function resolvePlayerMatch(
  players: Player[],
  name: string,
  allMatchPlayers?: MatchPlayer[]
): PlayerMatchResult {
  const clean = cleanPlayerName(name);
  if (!clean) return { candidates: [], isAmbiguous: false };
  const candidates = rankPlayerCandidates(players, clean);
  if (candidates.length === 0) {
    return { candidates: [], isAmbiguous: false };
  }

  const topScore = candidates[0].score;
  if (topScore < 60) {
    return { candidates: [], isAmbiguous: false };
  }

  const topCandidates = candidates.filter((c) => c.score === topScore);

  if (topCandidates.length === 1) {
    return { player: topCandidates[0].player, candidates, isAmbiguous: false };
  }

  // 1. Si alguno tiene coincidencia exacta
  const exactMatches = topCandidates.filter((c) => c.matchType === "exact");
  if (exactMatches.length === 1) {
    return { player: exactMatches[0].player, candidates, isAmbiguous: false };
  }

  // 2. Si se dispone del histórico de partidos jugados (PJ), preferir al existente con más PJ
  // (ej. caso "Juanjo" existente con 7 PJ)
  if (allMatchPlayers && allMatchPlayers.length > 0) {
    const pj = (pid: string) =>
      allMatchPlayers.filter((mp) => mp.playerId === pid && mp.attendanceStatus === "confirmed").length;
    const sorted = [...topCandidates].sort((a, b) => pj(b.player.id) - pj(a.player.id));
    const pj0 = pj(sorted[0].player.id);
    const pj1 = pj(sorted[1].player.id);
    if (pj0 > pj1 && pj0 > 0) {
      return { player: sorted[0].player, candidates, isAmbiguous: false };
    }
  }

  return { candidates: topCandidates, isAmbiguous: true };
}

export function findKnownPlayer(players: Player[], name: string, allMatchPlayers?: MatchPlayer[]): Player | undefined {
  return resolvePlayerMatch(players, name, allMatchPlayers).player;
}

export function normalizeName(value: string) {
  return cleanPlayerName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function revalidateSifupViews(matchId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/matches");
  revalidatePath("/payments");
  revalidatePath("/players");
  revalidatePath("/standings");
  if (matchId) revalidatePath(`/matches/${matchId}`);
}

export async function mergePlayers({ sourcePlayerId, targetPlayerId }: { sourcePlayerId: string; targetPlayerId: string }) {
  await dbMergePlayers(sourcePlayerId, targetPlayerId);
  revalidateSifupViews();
  return { success: true, message: "Jugadores fusionados exitosamente." };
}

export async function getMatchTeams(input: { matchId?: string; date?: string } = {}) {
  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);
  if (!match) throw new Error("No hay partidos registrados.");

  const rows = sortByWhatsappOrder(data.matchPlayers.filter((row) => row.matchId === match.id));
  const confirmed = rows.filter((row) => row.attendanceStatus === "confirmed");

  return {
    match,
    teams: {
      A: confirmed.filter((row) => row.team === "A").map(publicMatchPlayer),
      B: confirmed.filter((row) => row.team === "B").map(publicMatchPlayer),
      none: confirmed.filter((row) => row.team === "none").map(publicMatchPlayer),
    },
    messages: { teams: teamsMessage(match, rows) },
    url: `${PUBLIC_BASE_URL}/matches/${match.id}`,
  };
}

export type AssignPlayerTeamInput = {
  name?: string;
  playerId?: string;
  team: Team;
  matchId?: string;
  date?: string;
};

export async function assignPlayerTeam(input: AssignPlayerTeamInput) {
  if (!input.name && !input.playerId) throw new Error("Falta nombre o playerId del jugador.");

  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);
  if (!match) throw new Error("No hay partido para actualizar.");

  const rows = data.matchPlayers.filter((row) => row.matchId === match.id);
  let targetRow: MatchPlayer | undefined;
  if (input.playerId) {
    targetRow = rows.find((row) => row.playerId === input.playerId);
  } else if (input.name) {
    const known = findKnownPlayer(data.players, input.name);
    targetRow = known
      ? rows.find((row) => row.playerId === known.id)
      : rows.find((row) => normalizeName(row.name) === normalizeName(input.name!));
  }

  if (!targetRow) throw new Error(`${input.name ?? input.playerId} no está en la lista del partido.`);

  const previousTeam = targetRow.team;
  const now = new Date().toISOString();
  const updatedRows = rows.map((row) => (row.id === targetRow!.id ? { ...row, team: input.team, updatedAt: now } : row));

  await saveMatchPlayers(match.id, updatedRows);
  revalidateSifupViews(match.id);

  const sorted = sortByWhatsappOrder(updatedRows);
  const confirmed = sorted.filter((row) => row.attendanceStatus === "confirmed");
  const teamName = (t: Team) => (t === "A" ? "Rojo" : t === "B" ? "Amarillo" : "Sin equipo");

  return {
    status: "updated",
    player: targetRow.name,
    previousTeam,
    team: input.team,
    note: `${targetRow.name} movido de ${teamName(previousTeam)} a ${teamName(input.team)}.`,
    teams: {
      A: confirmed.filter((row) => row.team === "A").map(publicMatchPlayer),
      B: confirmed.filter((row) => row.team === "B").map(publicMatchPlayer),
      none: confirmed.filter((row) => row.team === "none").map(publicMatchPlayer),
    },
    messages: { teams: teamsMessage(match, sorted) },
  };
}

export type ReplaceMatchTeamsInput = {
  red: string[];
  yellow: string[];
  matchId?: string;
  date?: string;
};

/** Replaces the complete Rojo/Amarillo distribution without touching payments or attendance. */
export async function replaceMatchTeams(input: ReplaceMatchTeamsInput) {
  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);
  if (!match) throw new Error("No hay partido para actualizar.");

  const red = input.red.map((value) => value.trim()).filter(Boolean);
  const yellow = input.yellow.map((value) => value.trim()).filter(Boolean);
  const requested = [...red, ...yellow];
  const duplicateRequested = requested.find((value, index) => requested.findIndex((item) => normalizeName(item) === normalizeName(value)) !== index);
  if (duplicateRequested) throw new Error(`Jugador repetido en la distribución: ${duplicateRequested}.`);

  const rows = data.matchPlayers.filter((row) => row.matchId === match.id);
  const resolveRow = (value: string) => {
    const byId = rows.find((row) => row.playerId === value || row.id === value);
    if (byId) return byId;
    const matches = rows.filter((row) => normalizeName(row.name) === normalizeName(value));
    if (matches.length > 1) throw new Error(`Hay más de un jugador que coincide con ${value}; usa su playerId.`);
    return matches[0];
  };

  const assignments = new Map<string, Team>();
  for (const [team, values] of [["A", red], ["B", yellow]] as const) {
    for (const value of values) {
      const row = resolveRow(value);
      if (!row) throw new Error(`${value} no está en la lista del partido.`);
      if (row.attendanceStatus === "out") throw new Error(`${row.name} está marcado como No voy y no puede entrar a un equipo.`);
      assignments.set(row.id, team);
    }
  }

  const now = new Date().toISOString();
  const updatedRows = rows.map((row) => ({ ...row, team: assignments.get(row.id) ?? "none" as Team, updatedAt: now }));
  await saveMatchPlayers(match.id, updatedRows);
  revalidateSifupViews(match.id);

  const sorted = sortByWhatsappOrder(updatedRows);
  return {
    status: "replaced",
    match: { id: match.id, date: match.date, weekLabel: match.weekLabel },
    teams: {
      A: sorted.filter((row) => row.team === "A").map(publicMatchPlayer),
      B: sorted.filter((row) => row.team === "B").map(publicMatchPlayer),
      none: sorted.filter((row) => row.team === "none").map(publicMatchPlayer),
    },
    messages: { teams: teamsMessage(match, sorted) },
    note: `Distribución reemplazada: ${red.length} en Rojo, ${yellow.length} en Amarillo.`
  };
}

export type SetMatchResultInput = {
  scoreA: number;
  scoreB: number;
  matchId?: string;
  date?: string;
  notes?: string;
};

export async function setMatchResult(input: SetMatchResultInput) {
  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);
  if (!match) throw new Error("No hay partido para actualizar.");

  const winner: Winner = input.scoreA > input.scoreB ? "A" : input.scoreA < input.scoreB ? "B" : "draw";
  const existing = data.results.find((r) => r.matchId === match.id);
  const result: MatchResult = {
    id: existing?.id ?? newId("result"),
    matchId: match.id,
    scoreA: input.scoreA,
    scoreB: input.scoreB,
    winner,
    notes: input.notes ?? existing?.notes ?? "",
  };

  const rows = data.matchPlayers.filter((row) => row.matchId === match.id);
  await saveMatchPlayers(match.id, rows, result);
  revalidateSifupViews(match.id);

  return {
    status: "saved",
    match: { id: match.id, date: match.date, weekLabel: match.weekLabel },
    result: { scoreA: result.scoreA, scoreB: result.scoreB, winner: result.winner, notes: result.notes },
    messages: { finalResult: finalResultMessage(match, result) },
  };
}

export type GetPlayerStandingsInput = {
  limit?: number;
  minPlayed?: number;
};

export async function getPlayerStandings({ limit = 20, minPlayed = 1 }: GetPlayerStandingsInput = {}) {
  const data = await getSifupData();

  const ranked = data.players
    .map((player) => {
      const appearances = data.matchPlayers.filter(
        (row) => (row.playerId === player.id || row.name.toLowerCase() === player.name.toLowerCase()) && row.attendanceStatus === "confirmed",
      );
      const record = calculateRankingRecord(appearances, data.matches, data.results, data.matchTeams);
      return { id: player.id, name: player.name, isGoalkeeper: player.isGoalkeeper, ...record };
    })
    .filter((p) => p.played >= minPlayed)
    .sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.played - a.played)
    .slice(0, limit)
    .map((p, index) => ({ rank: index + 1, ...p }));

  return {
    total: ranked.length,
    standings: ranked,
    whatsappMessage: standingsMessage(ranked),
  };
}

function suggestedTeamForRank(pairIndex: number, positionInPair: number): Team {
  if (positionInPair > 1) return "none";
  const invertedPair = pairIndex % 2 === 1;
  if (!invertedPair) return positionInPair === 0 ? "A" : "B";
  return positionInPair === 0 ? "B" : "A";
}

export async function generateBalancedTeams(input: { matchId?: string; date?: string } = {}) {
  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);
  if (!match) throw new Error("No hay partidos registrados.");

  // Global standings: sort all players by points to assign ranks
  const globalRanks = new Map<string, { rank: number; points: number }>();
  data.players
    .map((player) => {
      const appearances = data.matchPlayers.filter(
        (row) => (row.playerId === player.id || row.name.toLowerCase() === player.name.toLowerCase()) && row.attendanceStatus === "confirmed",
      );
      const record = calculateRankingRecord(appearances, data.matches, data.results, data.matchTeams);
      return { id: player.id, points: record.points };
    })
    .sort((a, b) => b.points - a.points)
    .forEach((p, index) => globalRanks.set(p.id, { rank: index + 1, points: p.points }));

  const getStanding = (row: MatchPlayer) => {
    const pid = data.players.find((p) => p.id === row.playerId)?.id;
    return pid ? (globalRanks.get(pid) ?? { rank: Number.MAX_SAFE_INTEGER, points: 0 }) : { rank: Number.MAX_SAFE_INTEGER, points: 0 };
  };

  const rows = data.matchPlayers.filter((row) => row.matchId === match.id);
  const confirmed = rows.filter((row) => row.attendanceStatus === "confirmed");

  const isGoalkeeper = (row: MatchPlayer) => data.players.find((p) => p.id === row.playerId)?.isGoalkeeper === true;
  const goalkeepers = confirmed.filter((row) => isGoalkeeper(row));
  const fieldPlayers = confirmed.filter((row) => !isGoalkeeper(row));

  const sortByRank = (a: MatchPlayer, b: MatchPlayer) => {
    const sa = getStanding(a);
    const sb = getStanding(b);
    if (sa.rank !== sb.rank) return sa.rank - sb.rank;
    if (sa.points !== sb.points) return sb.points - sa.points;
    return (a.whatsappOrder || 0) - (b.whatsappOrder || 0);
  };

  const sortedField = [...fieldPlayers].sort(sortByRank);
  const sortedGoalkeepers = [...goalkeepers].sort(sortByRank);

  // Serpentine assignment for field players
  const teamAssignment = new Map<string, Team>();
  sortedField.forEach((row, index) => {
    teamAssignment.set(row.id, suggestedTeamForRank(Math.floor(index / 2), index % 2));
  });

  // Determine weaker team by summing field-player global points
  let pointsA = 0;
  let pointsB = 0;
  sortedField.forEach((row) => {
    const t = teamAssignment.get(row.id);
    const pts = getStanding(row).points;
    if (t === "A") pointsA += pts;
    else if (t === "B") pointsB += pts;
  });

  const weakerTeam: Team = pointsA <= pointsB ? "A" : "B";
  const strongerTeam: Team = weakerTeam === "A" ? "B" : "A";

  // Strongest goalkeeper goes to weaker team (against the #1 player's team)
  sortedGoalkeepers.forEach((row, index) => {
    let t: Team;
    if (index === 0) t = weakerTeam;
    else if (index === 1) t = strongerTeam;
    else t = index % 2 === 0 ? weakerTeam : strongerTeam;
    teamAssignment.set(row.id, t);
  });

  const now = new Date().toISOString();
  const updatedRows = rows.map((row) => {
    const newTeam = teamAssignment.get(row.id);
    return newTeam !== undefined ? { ...row, team: newTeam, updatedAt: now } : row;
  });

  await saveMatchPlayers(match.id, updatedRows);
  revalidateSifupViews(match.id);

  const sorted = sortByWhatsappOrder(updatedRows);
  const confirmedSorted = sorted.filter((row) => row.attendanceStatus === "confirmed");
  const assigned = confirmedSorted.filter((row) => row.team !== "none").length;

  return {
    status: "updated",
    match: { id: match.id, date: match.date, weekLabel: match.weekLabel },
    note: `${assigned} jugadores asignados a equipos equilibrados desde el ranking.`,
    teams: {
      A: confirmedSorted.filter((row) => row.team === "A").map(publicMatchPlayer),
      B: confirmedSorted.filter((row) => row.team === "B").map(publicMatchPlayer),
      none: confirmedSorted.filter((row) => row.team === "none").map(publicMatchPlayer),
    },
    messages: { teams: teamsMessage(match, sorted) },
  };
}

export type UpdateMatchInput = {
  matchId?: string;
  date?: string;
  status?: Match["status"];
  matchFormat?: Match["matchFormat"];
  squadTarget?: number;
  notes?: string;
  time?: string;
  location?: string;
  courtCost?: number;
  courtPrepaid?: boolean;
};

export async function updateMatch(input: UpdateMatchInput) {
  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);
  if (!match) throw new Error("No hay partido para actualizar.");

  const now = new Date().toISOString();
  const matchFormat = input.matchFormat ?? match.matchFormat;
  const defaultSquadTarget = matchFormat === "7x7" ? 14 : matchFormat === "rey_de_la_cancha" ? 18 : 12;
  const squadTarget = input.squadTarget ?? (input.matchFormat ? defaultSquadTarget : match.squadTarget ?? defaultSquadTarget);

  const updatedMatch: Match = {
    ...match,
    status: input.status ?? match.status,
    matchFormat,
    squadTarget,
    notes: input.notes !== undefined ? input.notes : match.notes,
    time: input.time ?? match.time,
    location: input.location ?? match.location,
    courtCost: input.courtCost ?? match.courtCost,
    courtPrepaid: input.courtPrepaid ?? match.courtPrepaid,
    updatedAt: now,
  };

  await saveMatch(updatedMatch);
  revalidateSifupViews(updatedMatch.id);

  const rows = data.matchPlayers.filter((r) => r.matchId === match.id);
  const result = data.results.find((r) => r.matchId === match.id);
  return buildMatchPayload(updatedMatch, rows, result, "updated", data.players, data.monthlyPayments);
}

export type UpdateMatchPlayerInput = {
  matchId?: string;
  date?: string;
  name?: string;
  playerId?: string;
  matchPlayerId?: string;
  attendanceStatus?: AttendanceStatus;
  team?: Team;
  amountDue?: number;
  amountPaid?: number;
  paymentStatus?: MatchPlayer["paymentStatus"];
  note?: string;
};

export async function updateMatchPlayer(input: UpdateMatchPlayerInput) {
  assertValidAmount(input.amountDue, "amountDue");
  assertValidAmount(input.amountPaid, "amountPaid");
  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);
  if (!match) throw new Error("No hay partido para actualizar.");

  const rows = data.matchPlayers.filter((r) => r.matchId === match.id);
  const targetRow = input.matchPlayerId
    ? rows.find((r) => r.id === input.matchPlayerId)
    : input.playerId
      ? rows.find((r) => r.playerId === input.playerId)
      : input.name
        ? rows.find((r) => normalizeName(r.name) === normalizeName(input.name!))
        : undefined;

  if (!targetRow) throw new Error("Jugador no encontrado en el partido.");

  const now = new Date().toISOString();
  const newStatus = input.attendanceStatus ?? targetRow.attendanceStatus;
  const isOut = newStatus === "out";
  const isMonthlyPlayer = targetRow.playerId
    ? isPlayerMonthlyForMonth(targetRow.playerId, match.monthKey, data.players, data.monthlyPayments)
    : false;
  // Un jugador "galleta" que queda confirmado nunca deberia quedar en $0: si no
  // se paso un monto explicito y el que tenia guardado es 0 (arrastrado de una
  // lista de espera o de cuando todavia figuraba mensual), se recalcula al
  // precio vigente para que no juegue gratis por error.
  const shouldRepriceGalleta = !isOut && newStatus === "confirmed" && !isMonthlyPlayer && input.amountDue === undefined && targetRow.amountDue === 0;
  const amountDue = isOut || isMonthlyPlayer ? 0 : input.amountDue !== undefined ? input.amountDue : shouldRepriceGalleta ? PER_MATCH_AMOUNT : targetRow.amountDue;
  // A real prior payment is never fabricated nor erased just by changing attendance
  // (e.g. marking someone "out" must not wipe out a payment they already made).
  const amountPaid = input.amountPaid !== undefined ? input.amountPaid : targetRow.amountPaid;

  const updatedRow: MatchPlayer = {
    ...targetRow,
    attendanceStatus: newStatus,
    team: isOut ? "none" : input.team ?? targetRow.team,
    amountDue,
    amountPaid,
    paymentStatus: isOut || isMonthlyPlayer
      ? "paid"
      : input.paymentStatus !== undefined
        ? input.paymentStatus
        : shouldRepriceGalleta
          ? (amountPaid >= amountDue ? "paid" : "unpaid")
          : targetRow.paymentStatus,
    note: isOut ? "No puede" : input.note !== undefined ? input.note : targetRow.note,
    updatedAt: now,
  };

  const updatedRows = rows.map((r) => (r.id === targetRow.id ? updatedRow : r));
  await saveMatchPlayers(match.id, updatedRows);
  revalidateSifupViews(match.id);

  const result = data.results.find((r) => r.matchId === match.id);
  return {
    status: "updated",
    player: updatedRow.name,
    row: publicMatchPlayer(updatedRow),
    matchPayload: buildMatchPayload(match, updatedRows, result, "updated", data.players, data.monthlyPayments),
  };
}

export type RemovePlayerFromMatchInput = {
  matchId?: string;
  date?: string;
  name?: string;
  playerId?: string;
  matchPlayerId?: string;
};

export async function removePlayerFromMatch(input: RemovePlayerFromMatchInput) {
  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);
  if (!match) throw new Error("No hay partido para actualizar.");

  const rows = data.matchPlayers.filter((r) => r.matchId === match.id);
  const targetRow = input.matchPlayerId
    ? rows.find((r) => r.id === input.matchPlayerId)
    : input.playerId
      ? rows.find((r) => r.playerId === input.playerId)
      : input.name
        ? rows.find((r) => normalizeName(r.name) === normalizeName(input.name!))
        : undefined;

  if (!targetRow) throw new Error("Jugador no encontrado en el partido.");

  const remainingRows = rows.filter((r) => r.id !== targetRow.id);
  await saveMatchPlayers(match.id, remainingRows);
  revalidateSifupViews(match.id);

  const result = data.results.find((r) => r.matchId === match.id);
  return {
    status: "removed",
    player: targetRow.name,
    remainingCount: remainingRows.length,
    matchPayload: buildMatchPayload(match, remainingRows, result, "updated", data.players, data.monthlyPayments),
  };
}

export async function deduplicateMatchPlayers(input: { matchId?: string; date?: string } = {}) {
  const data = await getSifupData();
  const match = resolveMatch(data.matches, input);
  if (!match) throw new Error("No hay partido para actualizar.");

  const rows = data.matchPlayers.filter((r) => r.matchId === match.id);
  const deduplicatedRows: MatchPlayer[] = [];
  let mergedCount = 0;

  for (const row of rows) {
    const norm = normalizeName(row.name);
    const existingIndex = deduplicatedRows.findIndex(
      (r) => (row.playerId && r.playerId === row.playerId) || normalizeName(r.name) === norm,
    );

    if (existingIndex >= 0) {
      const existing = deduplicatedRows[existingIndex];
      const combinedPaid = (existing.amountPaid || 0) + (row.amountPaid || 0);
      const combinedDue = Math.max(existing.amountDue || 0, row.amountDue || 0);
      const bestStatus: AttendanceStatus =
        existing.attendanceStatus === "confirmed" || row.attendanceStatus === "confirmed"
          ? "confirmed"
          : existing.attendanceStatus !== "out"
            ? existing.attendanceStatus
            : row.attendanceStatus;
      const bestTeam = existing.team !== "none" ? existing.team : row.team;

      deduplicatedRows[existingIndex] = {
        ...existing,
        ...mergedReceipt(existing, row),
        amountPaid: combinedPaid,
        amountDue: combinedDue,
        attendanceStatus: bestStatus,
        team: bestTeam,
        updatedAt: new Date().toISOString(),
      };
      mergedCount++;
    } else {
      deduplicatedRows.push(row);
    }
  }

  if (mergedCount > 0) {
    await saveMatchPlayers(match.id, deduplicatedRows);
    revalidateSifupViews(match.id);
  }

  const result = data.results.find((r) => r.matchId === match.id);
  return {
    status: mergedCount > 0 ? "deduplicated" : "no_duplicates",
    mergedCount,
    totalPlayers: deduplicatedRows.length,
    matchPayload: buildMatchPayload(match, deduplicatedRows, result, "updated", data.players, data.monthlyPayments),
  };
}


