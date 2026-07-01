export type MatchStatus = "open" | "confirmed" | "played" | "closed";
export type AttendanceStatus = "confirmed" | "maybe" | "out" | "waitlist";
export type PaymentStatus = "paid" | "unpaid" | "promised";
export type PaymentPlan = "monthly" | "perMatch";
export type Team = "A" | "B" | "none";
export type Winner = "A" | "B" | "draw";

export type Match = {
  id: string;
  date: string;
  time: string;
  location: string;
  status: MatchStatus;
  totalCost: number;
  weekLabel: string;
  monthKey: string;
  courtCost: number;
  courtPrepaid: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type Player = {
  id: string;
  name: string;
  nickname: string;
  phone: string;
  paymentPlan: PaymentPlan;
  skillLevel: 1 | 2 | 3 | 4 | 5;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MatchPlayer = {
  id: string;
  matchId: string;
  playerId?: string;
  name: string;
  phone: string;
  attendanceStatus: AttendanceStatus;
  paymentStatus: PaymentStatus;
  amountDue: number;
  amountPaid: number;
  note: string;
  team: Team;
  whatsappOrder: number;
  goals?: number;
  createdAt: string;
  updatedAt: string;
};

export type MatchResult = {
  id: string;
  matchId: string;
  scoreA: number;
  scoreB: number;
  winner: Winner;
  notes: string;
};

export type MonthlyPayment = {
  id: string;
  playerId: string;
  monthKey: string;
  expectedAmount: number;
  amountPaid: number;
  paymentStatus: PaymentStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type ClubFinance = {
  id: string;
  bank: string;
  account: string;
  email: string;
  rut: string;
  courtCost: number;
  prepaidCourts: number;
  prepaidTotal: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type SifupData = {
  matches: Match[];
  players: Player[];
  matchPlayers: MatchPlayer[];
  results: MatchResult[];
  monthlyPayments: MonthlyPayment[];
  clubFinance: ClubFinance;
};

export type MatchSummary = {
  confirmedCount: number;
  paidCount: number;
  unpaidCount: number;
  promisedCount: number;
  totalExpected: number;
  totalCollected: number;
  pendingAmount: number;
};
