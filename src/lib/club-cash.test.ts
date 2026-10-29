import assert from "node:assert/strict";
import test from "node:test";
import { clubCashSnapshot, clubCashYear } from "./club-cash";
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
  const before = structuredClone(data);
  const changed = structuredClone(data);
  changed.matches[0].status="suspended";
  changed.courtPayments=[{sourceMatchId:"oct",targetMatchId:"nov",expenseId:"court",amount:35000}];
  assert.deepEqual(clubCashSnapshot(changed,"2026-10-29"),cash);
  assert.equal(clubCashSnapshot(data,"2026-09-30").recordedDatedBalance,-35000);
  assert.deepEqual(data,before);
});
