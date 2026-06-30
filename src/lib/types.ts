export type MatchStatus = "open" | "confirmed" | "played" | "closed";
export type AttendanceStatus = "confirmed" | "maybe" | "out" | "waitlist";
export type PaymentStatus = "paid" | "unpaid" | "promised";
export type Team = "A" | "B" | "none";
export type Winner = "A" | "B" | "draw";

export type Match = {
  id: string;
  date: string;
  time: string;
  location: string;
  status: MatchStatus;
  totalCost: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type Player = {
  id: string;
  name: string;
  nickname: string;
  phone: string;
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
  attendanceStatus: AttendanceStatus;
  paymentStatus: PaymentStatus;
  amountDue: number;
  amountPaid: number;
  note: string;
  team: Team;
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

export type SifupData = {
  matches: Match[];
  players: Player[];
  matchPlayers: MatchPlayer[];
  results: MatchResult[];
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
