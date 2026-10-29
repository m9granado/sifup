import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { clubCashSnapshot, clubCashYear, monthlyFunds } from "./club-cash";
import type { SifupData } from "./types";

test("cash uses receipt/expense dates, excludes promises/credit and keeps unknowns explicit", () => {
  const data = {
    monthlyPayments: [{id:"next-fee",monthKey:"2026-11",amountPaid:20000,paidDate:"2026-10-28"},{id:"promise",monthKey:"2026-11",amountPaid:0,paymentStatus:"promised"},{id:"legacy",monthKey:"2026-09",amountPaid:20000,updatedAt:"2026-10-28T00:00Z"}],
    matchPlayers:[{id:"guest",matchId:"oct",amountPaid:5000,paidAt:"2026-10-28T03:02:00Z"},{id:"future",matchId:"nov",amountPaid:5000,paidDate:"2026-11-03"}],
    clubExpenses:[{id:"court",expenseDate:"2026-09-30",amount:35000,label:"Court",category:"court"},{id:"equipment",expenseDate:"2026-10-01",amount:2000,label:"Equipment",category:"equipment"},{id:"discount",expenseDate:"2026-10-02",amount:-1000,label:"Unclassified discount",category:"other"}],
    matches:[{id:"oct",date:"2026-10-27",status:"confirmed",courtPrepaid:true,courtCost:35000}],courtPayments:[],
  } as unknown as SifupData;
  const cash = clubCashSnapshot(data,"2026-10-29");
  assert.equal(cash.recordedDatedBalance,-12000);
  assert.equal(cash.periodReceived,25000);
  assert.equal(cash.periodDisbursed,2000);
  assert.equal(cash.undatedReceived,20000);
  assert.equal(cash.unclassified.length,1);
  assert.equal(cash.reconciled,false);
  const year = clubCashYear(data,2026,"2026-10-29");
  assert.equal(year[8].gastosCancha,35000);
  assert.equal(year[8].mensual,0); // Legacy receipt has no verified date.
  assert.equal(year[9].mensual,20000); // November fee actually received in October.
  assert.equal(year[9].galletas,5000);
  assert.equal(year[9].otrosGastos,2000); // Discount is not a cash outflow.
  assert.equal(year[9].running,cash.recordedDatedBalance);
  assert.equal(year[10].mensual,0);
  assert.equal(year[10].galletas,0); // Future-dated money excluded at cutoff.
  assert.equal(year[10].gastosCancha,0);
  assert.equal(year[10].otrosGastos,0);
  assert.equal(clubCashSnapshot(data,"2026-11-29").periodDisbursed,0);
  const before = structuredClone(data);
  const changed = structuredClone(data);
  changed.matches[0].status="suspended";
  changed.courtPayments=[{sourceMatchId:"oct",targetMatchId:"nov",expenseId:"court",amount:35000}];
  assert.deepEqual(clubCashSnapshot(changed,"2026-10-29"),cash);
  assert.equal(clubCashSnapshot(data,"2026-09-30").recordedDatedBalance,-35000);
  assert.deepEqual(data,before);
});

test("monthly funds count advances by fee/match month without moving receipts or duplicating court spend", () => {
  const data = {
    monthlyPayments: [
      { id: "advance", monthKey: "2026-11", amountPaid: 20000, paidDate: "2026-10-28", paidAt: "2026-10-28T12:00Z" },
      { id: "unknown-date", monthKey: "2026-11", amountPaid: 7000, updatedAt: "2026-10-29" },
      { id: "promise", monthKey: "2026-11", amountPaid: 0, paymentStatus: "promised", expectedAmount: 20000 },
      { id: "late-oct", monthKey: "2026-10", amountPaid: 9000, paidDate: "2026-11-03" },
    ],
    matchPlayers: [
      { id: "guest", matchId: "nov", amountPaid: 5000, paidAt: "2026-10-29T01:00Z", attendanceStatus: "confirmed" },
      { id: "future", matchId: "nov", amountPaid: 5000, paidDate: "2026-11-04" },
      { id: "pending", matchId: "nov", amountPaid: 0, amountDue: 5000 },
    ],
    matches: [{ id: "nov", date: "2026-11-03", monthKey: "2026-10", courtCost: 35000, totalCost: 35000, courtPrepaid: true }],
    clubExpenses: [
      { id: "prepaid", expenseDate: "2026-10-01", amount: 35000, category: "court" },
      { id: "new", expenseDate: "2026-11-01", amount: 2000, category: "equipment" },
      { id: "discount", expenseDate: "2026-11-01", amount: -1000, category: "other" },
    ], courtPayments: [{sourceMatchId: "oct", targetMatchId: "nov", expenseId: "prepaid", amount: 35000}],
  } as unknown as SifupData;
  const before = structuredClone(data);
  const advance = monthlyFunds(data, "2026-11", "2026-10-29");
  assert.equal(advance.received, 32000);
  assert.equal(advance.disbursed, 0);
  assert.equal(advance.balance, 32000);
  assert.equal(advance.undatedReceived, 7000);
  assert.equal(advance.receipts.find(item => item.id === "guest")?.date, "2026-10-28");
  assert.equal(monthlyFunds(data, "2026-10", "2026-10-29").received, 0);
  const november = monthlyFunds(data, "2026-11", "2026-11-30");
  assert.equal(november.received, 37000);
  assert.equal(november.disbursed, 2000);
  assert.equal(november.balance, 35000);
  assert.equal(monthlyFunds(data, "2026-10", "2026-11-30").received, 9000);
  assert.equal(clubCashYear(data, 2026, "2026-11-30")[9].mensual, 20000);
  const changed = structuredClone(data);
  changed.courtPayments = [];
  changed.matches[0].courtPrepaid = false;
  assert.deepEqual(monthlyFunds(changed, "2026-11", "2026-11-30"), november);
  assert.equal(monthlyFunds(data, "2026-12", "2026-12-31").balance, 0);
  assert.equal(Object.is(monthlyFunds(data, "2026-12", "2026-12-31").disbursed, -0), false);
  assert.deepEqual(data, before); // Receipt dates, amounts, statuses and all business rows stay intact.
});

test("payments month and cash cutoff share Santiago at the UTC month boundary", () => {
  const source = readFileSync(new URL("../components/admin/SifupWorkspace.tsx", import.meta.url), "utf8");
  const page = source.split("export function PaymentsPage(")[1].split("function markPaid(")[0];
  assert.match(page, /const month = cutoff\.slice\(0, 7\)/);
  const expression = page.match(/const cutoff = (.+);/)![1];
  const FixedDate = class extends Date { constructor() { super("2026-11-01T01:00:00Z"); } };
  const cutoff = new Function("Date", `return ${expression}`)(FixedDate);
  assert.equal(cutoff,"2026-10-31");
  assert.equal(cutoff.slice(0,7),"2026-10");
});
