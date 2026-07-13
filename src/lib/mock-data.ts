import type {
  AttendanceStatus,
  ClubFinance,
  ClubExpense,
  Match,
  MatchPlayer,
  MonthlyPayment,
  PaymentPlan,
  PaymentStatus,
  Player,
  SifupData,
  Team,
} from "./types";

const now = new Date().toISOString();

const MONTH_KEY = "2026-06";
const CURRENT_MONTH_KEY = "2026-07";
const MONTHLY_AMOUNT = 20000;
const PER_MATCH_AMOUNT = 3500;
const COURT_COST = 35000;

const playerSeeds: Array<{
  id: string;
  name: string;
  nickname: string;
  paymentPlan: PaymentPlan;
}> = [
  { id: "player-victor", name: "Victor", nickname: "Victor", paymentPlan: "monthly" },
  { id: "player-marcio", name: "Marcio", nickname: "Marcio", paymentPlan: "monthly" },
  { id: "player-mario-q", name: "Mario Quintana", nickname: "Mario Q", paymentPlan: "monthly" },
  { id: "player-mella", name: "Mella", nickname: "Mella", paymentPlan: "monthly" },
  { id: "player-juanjo", name: "Juanjo", nickname: "Juanjo", paymentPlan: "monthly" },
  { id: "player-francis", name: "Francis", nickname: "Francis", paymentPlan: "monthly" },
  { id: "player-cooper", name: "Cooper", nickname: "Cooper", paymentPlan: "monthly" },
  { id: "player-caldera", name: "Caldera", nickname: "Caldera", paymentPlan: "monthly" },
  { id: "player-alonso", name: "Alonso", nickname: "Alonso", paymentPlan: "monthly" },
  { id: "player-ale-moran", name: "Ale Moran", nickname: "Ale", paymentPlan: "perMatch" },
  { id: "player-amigo-ale-arquero", name: "Amigo Ale M Arquero", nickname: "Arquero Ale", paymentPlan: "perMatch" },
  { id: "player-amigo-2-ale", name: "Amigo 2 Ale Moran", nickname: "Amigo Ale 2", paymentPlan: "perMatch" },
  { id: "player-stgo-mantelli", name: "Stgo Mantelli", nickname: "Mantelli", paymentPlan: "perMatch" },
  { id: "player-piti", name: "Piti", nickname: "Piti", paymentPlan: "perMatch" },
  { id: "player-matias", name: "Matias", nickname: "Matias", paymentPlan: "perMatch" },
  { id: "player-beto", name: "Beto", nickname: "Beto", paymentPlan: "perMatch" },
  { id: "player-pololo-francis", name: "Pololo de Francis", nickname: "Pololo Francis", paymentPlan: "perMatch" },
  { id: "player-galleta", name: "Galleta", nickname: "Galleta", paymentPlan: "perMatch" },
  { id: "player-felipe-arquero", name: "Felipe arquero", nickname: "Felipe", paymentPlan: "perMatch" },
];

const players: Player[] = playerSeeds.map((player, index) => ({
  id: player.id,
  name: player.name,
  nickname: player.nickname,
  phone: "",
  paymentPlan: player.paymentPlan,
  skillLevel: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
  active: true,
  shortName: player.name.slice(0, 3).toUpperCase(),
  isGoalkeeper: player.name.toLowerCase().includes("arquero"),
  createdAt: now,
  updatedAt: now,
}));

const playerByName = new Map(players.map((player) => [player.name, player]));

function matchPlayer(
  matchId: string,
  index: number,
  name: string,
  paymentStatus: PaymentStatus,
  amountDue: number,
  amountPaid: number,
  note = "",
  team: Team = "none",
  attendanceStatus: AttendanceStatus = "confirmed",
): MatchPlayer {
  const player = playerByName.get(name);
  return {
    id: `${matchId}-player-${index}`,
    matchId,
    playerId: player?.id,
    name,
    phone: player?.phone ?? "",
    attendanceStatus,
    paymentStatus,
    amountDue,
    amountPaid,
    note,
    team,
    whatsappOrder: index,
    createdAt: now,
    updatedAt: now,
  };
}

const matches: Match[] = [
  {
    id: "match-2026-06-30",
    date: "2026-06-30",
    time: "21:00",
    location: "Club Sordos, Av. Jose Pedro Alessandri 1251, Nunoa",
    status: "confirmed",
    totalCost: COURT_COST,
    weekLabel: "3a sem Jun",
    monthKey: MONTH_KEY,
    courtCost: COURT_COST,
    courtPrepaid: true,
    notes: "Tercer partido. Cancha ya pagada dentro del paquete de 5 canchas.",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "match-2026-06-23",
    date: "2026-06-23",
    time: "21:00",
    location: "Club Sordos, Av. Jose Pedro Alessandri 1251, Nunoa",
    status: "played",
    totalCost: COURT_COST,
    weekLabel: "2a sem Jun",
    monthKey: MONTH_KEY,
    courtCost: COURT_COST,
    courtPrepaid: true,
    notes: "Futbolito martes 23 junio. Segundo partido registrado.",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "match-2026-06-09",
    date: "2026-06-09",
    time: "21:00",
    location: "Cancha de los Sordos",
    status: "played",
    totalCost: COURT_COST,
    weekLabel: "1a sem Jun",
    monthKey: MONTH_KEY,
    courtCost: COURT_COST,
    courtPrepaid: true,
    notes: "Martes 09/06. 3.000 por persona. Primer partido registrado.",
    createdAt: now,
    updatedAt: now,
  },
];

const matchPlayers: MatchPlayer[] = [
  ...[
    ["Victor", "paid", "A", 0, 0, "mensualidad"],
    ["Galleta", "unpaid", "none", PER_MATCH_AMOUNT, 0, ""],
    ["Marcio", "paid", "B", 0, 0, "mensualidad"],
    ["Juanjo", "paid", "A", 0, 0, "mensualidad"],
    ["Beto", "unpaid", "none", PER_MATCH_AMOUNT, 0, ""],
    ["Francis", "paid", "B", 0, 0, "mensualidad"],
    ["Cooper", "paid", "A", 0, 0, "mensualidad"],
    ["Stgo Mantelli", "unpaid", "B", PER_MATCH_AMOUNT, 0, ""],
    ["Pololo de Francis", "unpaid", "none", PER_MATCH_AMOUNT, 0, ""],
    ["Mario Quintana", "paid", "A", 0, 0, "mensualidad"],
    ["Alonso Duran", "promised", "B", PER_MATCH_AMOUNT, 0, "pago manana"],
    ["Felipe arquero", "unpaid", "none", PER_MATCH_AMOUNT, 0, "galleta Cooper"],
  ].map(([name, paymentStatus, team, amountDue, amountPaid, note], index) =>
    matchPlayer("match-2026-06-30", index + 1, String(name), paymentStatus as PaymentStatus, Number(amountDue), Number(amountPaid), String(note), team as Team),
  ),
  ...[
    ["Victor", "paid", "A", 0, 0, "pagado fijo"],
    ["Marcio", "paid", "B", 0, 0, "pagado fijo"],
    ["Mario Quintana", "paid", "A", 0, 0, "pagado fijo"],
    ["Mella", "paid", "B", 0, 0, "pagado fijo"],
    ["Juanjo", "paid", "A", 0, 0, "pagado fijo"],
    ["Francis", "paid", "B", 0, 0, "pagado fijo"],
    ["Ale Moran", "promised", "A", PER_MATCH_AMOUNT, 0, "Galleta Cooper por manana"],
    ["Amigo Ale M Arquero", "promised", "B", PER_MATCH_AMOUNT, 0, "Galleta Cooper por manana"],
    ["Amigo 2 Ale Moran", "promised", "A", PER_MATCH_AMOUNT, 0, "Galleta Cooper por manana"],
    ["Stgo Mantelli", "unpaid", "B", PER_MATCH_AMOUNT, 0, ""],
    ["Cooper", "paid", "none", 0, 0, "No puede. Pagado fijo"],
    ["Caldera", "paid", "none", 0, 0, "No puede. Pagado fijo"],
    ["Alonso", "paid", "none", 0, 0, "No puede. Pagado, enfermo"],
  ].map(([name, paymentStatus, team, amountDue, amountPaid, note], index) =>
    matchPlayer(
      "match-2026-06-23",
      index + 1,
      String(name),
      paymentStatus as PaymentStatus,
      Number(amountDue),
      Number(amountPaid),
      String(note),
      team as Team,
      index >= 10 ? "out" : "confirmed",
    ),
  ),
  ...["Marcio", "Juanjo", "Victor", "Cooper", "Mario Quintana", "Piti", "Caldera", "Mella", "Alonso", "Matias"].map(
    (name, index) =>
      matchPlayer(
        "match-2026-06-09",
        index + 1,
        name,
        playerByName.get(name)?.paymentPlan === "monthly" ? "paid" : "paid",
        playerByName.get(name)?.paymentPlan === "monthly" ? 0 : 3000,
        playerByName.get(name)?.paymentPlan === "monthly" ? 0 : 3000,
        index === 9 ? "primo Juanjo" : "",
        index % 2 === 0 ? "A" : "B",
      ),
  ),
];

const monthlyPayments: MonthlyPayment[] = players
  .filter((player) => player.paymentPlan === "monthly")
  .flatMap((player) => [
    {
      id: `monthly-${MONTH_KEY}-${player.id}`,
      playerId: player.id,
      monthKey: MONTH_KEY,
      expectedAmount: MONTHLY_AMOUNT,
      amountPaid: MONTHLY_AMOUNT,
      paymentStatus: "paid" as const,
      note: "Mensualidad junio, vencimiento 10/06",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `monthly-${CURRENT_MONTH_KEY}-${player.id}`,
      playerId: player.id,
      monthKey: CURRENT_MONTH_KEY,
      expectedAmount: MONTHLY_AMOUNT,
      amountPaid: 0,
      paymentStatus: "unpaid" as const,
      note: "Mensualidad julio, vencimiento 10/07",
      createdAt: now,
      updatedAt: now,
    },
  ]);

const clubExpenses: ClubExpense[] = [
  {
    id: "expense-2026-06-courts",
    expenseDate: "2026-06-10",
    label: "Paquete 5 canchas Club Sordos",
    amount: 175000,
    category: "court",
    note: "Pago base relativo al ciclo 10/06.",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "expense-2026-07-ball",
    expenseDate: "2026-07-10",
    label: "Pelota nueva",
    amount: 20000,
    category: "equipment",
    note: "Estimado 20 lucas.",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "expense-2026-07-bibs",
    expenseDate: "2026-07-10",
    label: "Petos",
    amount: 20000,
    category: "equipment",
    note: "Estimado 20 lucas.",
    createdAt: now,
    updatedAt: now,
  },
];

const clubFinance: ClubFinance = {
  id: "club-finance-main",
  bank: "Cuenta vista Banco BCI MACH",
  account: "777915748221",
  email: "vigomez@uchile.cl",
  rut: "157482211",
  courtCost: COURT_COST,
  prepaidCourts: 5,
  prepaidTotal: 175000,
  notes: "5 canchas pagadas en Club Sordos.",
  createdAt: now,
  updatedAt: now,
};

export const seedData: SifupData = {
  matches,
  players,
  matchPlayers,
  results: [
    {
      id: "result-2026-06-23",
      matchId: "match-2026-06-23",
      scoreA: 0,
      scoreB: 0,
      winner: "draw",
      notes: "Resultado por completar.",
    },
    {
      id: "result-2026-06-09",
      matchId: "match-2026-06-09",
      scoreA: 0,
      scoreB: 0,
      winner: "draw",
      notes: "Resultado por completar.",
    },
  ],
  monthlyPayments,
  clubExpenses,
  clubFinance,
};
