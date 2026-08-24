import type { MatchTeamColor, PaymentStatus, Team } from "./types";

export const PER_MATCH_AMOUNT = 3500;
export const MONTHLY_AMOUNT = 20000;
export const COURT_COST = 35000;
export const WIN_POINTS = 3;
export const DRAW_POINTS = 1;
export const LOSS_POINTS = 0;
export const STANDINGS_WINDOW = 5;
export const SQUAD_TARGET = 12;

export const ROYAL_GOAL_DIFF_TO_WIN = 2;
export const ROYAL_GAME_TIME_LIMIT_MIN = 10;
export const ROYAL_SQUAD_TARGET = 18;
export const ROYAL_TEAM_SIZE = 6;

export const MATCH_TEAM_DEFAULT_COLORS: MatchTeamColor[] = ["red", "gold", "green"];

export const MATCH_TEAM_COLOR_CLASSES: Record<MatchTeamColor, { border: string; bg: string; text: string }> = {
  red: { border: "border-(--red)/35", bg: "bg-(--red)/10", text: "text-(--red)" },
  gold: { border: "border-(--gold)/40", bg: "bg-(--gold)/10", text: "text-(--gold)" },
  green: { border: "border-(--green)/40", bg: "bg-(--green)/10", text: "text-(--green)" },
  cyan: { border: "border-(--cyan)/40", bg: "bg-(--cyan)/10", text: "text-(--cyan)" },
};

export const MATCH_TEAM_COLOR_LABEL: Record<MatchTeamColor, string> = {
  red: "Rojo",
  gold: "Amarillo",
  green: "Verde",
  cyan: "Celeste",
};

export const PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sifup.vercel.app";

export const TEAM_NAME: Record<Team, string> = {
  A: "Rojo",
  B: "Amarillo",
  none: "Sin equipo",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: "Pagado",
  unpaid: "No pagado",
  promised: "Prometido",
};

export const ATTENDANCE_LABEL: Record<string, string> = {
  confirmed: "Confirmado",
  maybe: "Tal vez",
  out: "No puede",
  waitlist: "En espera",
};
