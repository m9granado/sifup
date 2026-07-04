import type { PaymentStatus, Team } from "./types";

export const PER_MATCH_AMOUNT = 3500;
export const MONTHLY_AMOUNT = 20000;
export const COURT_COST = 35000;
export const WIN_POINTS = 4;
export const DRAW_POINTS = 2;
export const SQUAD_TARGET = 12;

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
