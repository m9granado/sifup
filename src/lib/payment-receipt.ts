export type PaymentReceipt = { paidDate?: string; paidAt?: string };

/** Date-only stays a date. A clock time requires Z or an explicit UTC offset. */
export function parsePaymentReceipt(receivedAt: string): PaymentReceipt {
  const date = receivedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 4) === "0000") {
    throw new Error("receivedAt requiere una fecha real YYYY-MM-DD.");
  }
  const calendar = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date) {
    throw new Error("Fecha de recepcion imposible.");
  }
  if (receivedAt === date) return { paidDate: date, paidAt: undefined };
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(receivedAt)
    || /[+-]14:(?!00)/.test(receivedAt) || receivedAt.endsWith("-00:00")) {
    throw new Error("Hora de recepcion requiere ISO 8601 con zona explicita (Z o ±HH:MM, hasta ±14:00).");
  }
  const instant = new Date(receivedAt);
  if (!Number.isFinite(instant.getTime())) throw new Error("Hora de recepcion invalida.");
  return { paidDate: date, paidAt: instant.toISOString() };
}

/** Never silently discard a receipt while consolidating duplicate records. */
export function mergedReceipt(a: PaymentReceipt & { amountPaid: number }, b: PaymentReceipt & { amountPaid: number }): PaymentReceipt {
  if (a.amountPaid > 0 && b.amountPaid > 0 && (a.paidAt !== b.paidAt || a.paidDate !== b.paidDate)) {
    throw new Error("Pagos con fechas diferentes: conciliar antes de fusionar.");
  }
  const source = a.amountPaid > 0 ? a : b;
  return { paidAt: source.paidAt, paidDate: source.paidDate };
}
