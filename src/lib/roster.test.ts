import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { Children, isValidElement, type ReactElement } from "react";
import { planRosterChange, planRosterClose, rosterCloseProposal, rosterWaitlistRows, sortByWhatsappOrder, type RosterCloseChoice, type RosterCloseProposal } from "./store";
import type { Match, MatchPlayer, MonthlyPayment, SifupData } from "./types";

const matches = [
  { id: "m-jul", monthKey: "2026-07" },
  { id: "m-ago", monthKey: "2026-08" },
] as Match[];

function row(partial: Partial<MatchPlayer>): MatchPlayer {
  return { id: "r", matchId: "m-jul", name: "Juanjo", attendanceStatus: "confirmed", paymentStatus: "unpaid", amountDue: 0, amountPaid: 0, note: "", ...partial } as MatchPlayer;
}

test("a mensual cancela solo galletas impagas del mes y respeta lo ya pagado", () => {
  const plan = planRosterChange({
    playerRows: [
      row({ id: "a", amountDue: 3500 }),
      row({ id: "b", amountDue: 5000, amountPaid: 5000, paymentStatus: "paid" }),
      row({ id: "c", matchId: "m-ago", amountDue: 5000 }),
      row({ id: "d", attendanceStatus: "out", amountDue: 5000 }),
    ],
    matches,
    monthKey: "2026-07",
    monthly: true,
  });
  assert.equal(plan.unpaidGalletaCount, 1);
  assert.equal(plan.unpaidGalletaAmount, 3500);
  assert.equal(plan.paidGalletaAmount, 5000);
  assert.deepEqual(plan.rowUpdates.map((update) => [update.id, update.amountDue, update.paymentStatus]), [["a", 0, "paid"]]);
  assert.match(plan.rowUpdates[0].note, /mensualidad/);
});

test("a mensual sin cancelar solo informa el monto", () => {
  const plan = planRosterChange({ playerRows: [row({ id: "a", amountDue: 3500 })], matches, monthKey: "2026-07", monthly: true, cancelGalletas: false });
  assert.equal(plan.unpaidGalletaAmount, 3500);
  assert.equal(plan.rowUpdates.length, 0);
});

test("a galleta recalcula partidos confirmados a $0 y avisa mensualidad pagada", () => {
  const payment = { paymentStatus: "paid", amountPaid: 20000 } as MonthlyPayment;
  const plan = planRosterChange({
    playerRows: [
      row({ id: "a", paymentStatus: "paid", note: "mensualidad" }),
      row({ id: "b", attendanceStatus: "out" }),
      row({ id: "c", matchId: "m-ago" }),
    ],
    matches,
    monthKey: "2026-07",
    monthly: false,
    payment,
  });
  assert.equal(plan.repricedCount, 1);
  assert.equal(plan.paidMonthlyAmount, 20000);
  assert.deepEqual(plan.rowUpdates, [{ id: "a", amountDue: 5000, amountPaid: 0, paymentStatus: "unpaid", note: "" }]);
});

test("roster changes preserve suspended dates, received money and other months", () => {
  const dates = [
    { id: "suspended", date: "2026-10-06", monthKey: "2026-10", status: "suspended" },
    { id: "played", date: "2026-10-27", monthKey: "2026-09", status: "played" },
    { id: "nov", date: "2026-11-03", monthKey: "2026-11", status: "confirmed" },
  ] as Match[];
  const rows = [row({ id: "s", matchId: "suspended" }), row({ id: "p", matchId: "played" }), row({ id: "cash", matchId: "played", amountPaid: 1000 }), row({ id: "n", matchId: "nov" })];
  const before = structuredClone(rows);
  const plan = planRosterChange({ playerRows: rows, matches: dates, monthKey: "2026-10", monthly: false });
  assert.deepEqual(plan.rowUpdates.map(update => update.id), ["p"]);
  assert.equal(plan.repricedCount, 1);
  const monthly = planRosterChange({ playerRows: [row({ id: "s", matchId: "suspended", amountDue: 5000 })], matches: dates, monthKey: "2026-10", monthly: true });
  assert.deepEqual(monthly.rowUpdates, []);
  assert.deepEqual(rows, before);
});

function closeFixture(target = 12, waitingCount = 3, confirmedCount = target - 2) {
  const match = { ...matches[0], status: "confirmed", matchFormat: target === 14 ? "7x7" : "clasico", squadTarget: target, notes: "fixture", updatedAt: "before" } as Match;
  const confirmed = Array.from({ length: confirmedCount }, (_, index) => row({ id: `confirmed-${index}`, name: `Confirmado ${index}`, whatsappOrder: index + 1, updatedAt: "before" }));
  const statuses = ["banca", "galleta", "waitlist"] as const;
  const waiting = Array.from({ length: waitingCount }, (_, index) => row({
    id: `waiting-${index}`, name: `Espera ${index}`, attendanceStatus: statuses[index % statuses.length], whatsappOrder: confirmedCount + index + 1,
    playerId: `fixture-${index}`, phone: "fixture", paymentStatus: "promised", amountDue: 5000, amountPaid: 1000,
    paidAt: "2026-07-01T12:00:00Z", paidDate: "2026-07-01", note: "conservar", team: "A", teamId: "equipo-fixture", goals: 2, createdAt: "created", updatedAt: "before",
  }));
  return { match, rows: [...confirmed, ...waiting] };
}

for (const target of [12, 14]) {
  for (const waitingCount of [1, 2, 4]) {
    test(`cierre ${target}: banca ${waitingCount}, límites, orden y ambas decisiones`, () => {
      const { match, rows } = closeFixture(target, waitingCount);
      const before = structuredClone(rows);
      const proposal = rosterCloseProposal(match, [...rows].reverse());
      assert.equal(proposal.vacancies, 2);
      assert.equal(proposal.selected.length, Math.min(2, waitingCount));
      assert.equal(proposal.remainingVacancies, Math.max(0, 2 - waitingCount));
      assert.deepEqual(proposal.selected, rosterWaitlistRows(rows).slice(0, 2).map(({ id, name }) => ({ id, name })));
      for (const choice of ["include", "exclude"] as const) {
        const plan = planRosterClose(proposal, proposal.snapshot, choice, "after");
        assert.equal(plan.status, "ready");
        if (plan.status !== "ready") throw new Error("Se esperaba un cierre válido");
        assert.deepEqual(plan.playerUpdates.map((update) => update.id), choice === "include" ? proposal.selected.map((item) => item.id) : []);
        assert.deepEqual(plan.matchUpdate, { status: "roster_locked", updatedAt: "after" });
        for (const update of plan.playerUpdates) assert.deepEqual(Object.keys(update).sort(), ["attendanceStatus", "id", "updatedAt"]);
      }
      assert.deepEqual(rows, before);
    });
  }
}

test("En espera comparte orden, desempate estable, fallback de ID y exclusión de no elegibles", () => {
  const { match } = closeFixture();
  match.squadTarget = 12;
  const rows = [
    row({ id: "fixture-player-3", name: "C", attendanceStatus: "banca", whatsappOrder: 0 }),
    row({ id: "z", name: "B", attendanceStatus: "waitlist", whatsappOrder: 1 }),
    row({ id: "a2", name: "A", attendanceStatus: "galleta", whatsappOrder: 1 }),
    row({ id: "a1", name: "A", attendanceStatus: "banca", whatsappOrder: 1 }),
    row({ id: "out", attendanceStatus: "out", whatsappOrder: -2 }),
    row({ id: "maybe", attendanceStatus: "maybe", whatsappOrder: -1 }),
    row({ id: "other-match", matchId: "other", attendanceStatus: "waitlist", whatsappOrder: -3 }),
  ];
  const proposal = rosterCloseProposal(match, rows);
  assert.deepEqual(proposal.selected.map((item) => item.id), ["a1", "a2", "z", "fixture-player-3"]);
  assert.deepEqual(rosterCloseProposal(match, [...rows].reverse()), proposal);
  assert.deepEqual(rosterWaitlistRows(rows.slice(0, 4)).map((item) => item.name), sortByWhatsappOrder(rows.slice(0, 4)).map((item) => item.name));
  assert.equal(proposal.remainingVacancies, 8);
});

test("snapshot obsoleto nunca escribe ni sustituye personas; primer cierre descubre banca nueva", () => {
  const { match, rows } = closeFixture();
  const original = rosterCloseProposal(match, rows);
  const changedRows = rows.map((item) => item.id === "waiting-0" ? { ...item, id: "replacement", name: "Otra persona" } : item);
  const variants = [
    rosterCloseProposal(match, changedRows),
    rosterCloseProposal({ ...match, squadTarget: 14 }, rows),
    rosterCloseProposal(match, rows.map((item) => item.id === "waiting-0" ? { ...item, name: "Nombre cambiado" } : item)),
    rosterCloseProposal(match, rows.map((item) => item.id === "waiting-2" ? { ...item, whatsappOrder: -1 } : item)),
    rosterCloseProposal(match, rows.slice(1)),
  ];
  for (const proposal of variants) {
    for (const choice of ["include", "exclude"] as const) {
      const plan = planRosterClose(proposal, original.snapshot, choice, "after");
      assert.equal(plan.status, "changed");
      assert.equal("playerUpdates" in plan, false);
      assert.equal("matchUpdate" in plan, false);
    }
  }
  const noWaiting = rosterCloseProposal(match, rows.filter((item) => item.attendanceStatus === "confirmed"));
  assert.equal(planRosterClose(original, noWaiting.snapshot, "exclude", "after").status, "changed");
  assert.equal(planRosterClose(noWaiting, original.snapshot, "include", "after").status, "reload");
});

test("cierre normal, cupo lleno y estados no aplicables", () => {
  for (const [confirmedCount, waitingCount] of [[10, 0], [12, 3]]) {
    const { match, rows } = closeFixture(12, waitingCount, confirmedCount);
    const proposal = rosterCloseProposal(match, rows);
    assert.equal(proposal.selected.length, 0);
    assert.equal(planRosterClose(proposal, proposal.snapshot, "exclude", "after").status, "ready");
  }
  for (const status of ["roster_locked", "played", "suspended"] as const) {
    const { match, rows } = closeFixture();
    const proposal = rosterCloseProposal({ ...match, status }, rows);
    assert.equal(planRosterClose(proposal, proposal.snapshot, "include", "after").status, "reload");
  }
  const overflow = closeFixture(12, 3, 13);
  const proposal = rosterCloseProposal(overflow.match, overflow.rows);
  assert.equal(planRosterClose(proposal, proposal.snapshot, "exclude", "after").status, "reload");
  const royal = rosterCloseProposal({ ...overflow.match, matchFormat: "rey_de_la_cancha" }, overflow.rows);
  assert.equal(royal.squadTarget, 18);
});

const fixtureRequire = createRequire(import.meta.url);

function loadCloseModule(file: string, dependencies: Record<string, unknown>, extraExports = "") {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${source}\n${extraExports}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports,document,HTMLElement,window){${compiled}\n})`)((name: string) => dependencies[name] ?? {}, loaded, loaded.exports, dependencies.document, dependencies.HTMLElement, dependencies.window);
  return loaded.exports;
}

function closeRepositoryFixture(failMatchWrite = false) {
  let state = closeFixture();
  const queries: string[] = [];
  const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(statement);
    if (statement === "select id, status, match_format, squad_target from matches where id = ? for update") {
      assert.equal(values[0], state.match.id);
      return [{ id: state.match.id, status: state.match.status, match_format: state.match.matchFormat, squad_target: state.match.squadTarget }];
    }
    if (statement === "select id, name, attendance_status, whatsapp_order from match_players where match_id = ? order by id for update") {
      assert.equal(values[0], state.match.id);
      return state.rows.map((item) => ({ id: item.id, name: item.name, attendance_status: item.attendanceStatus, whatsapp_order: item.whatsappOrder }));
    }
    if (statement === "update match_players set attendance_status = ?, updated_at = ? where match_id = ? and id = ?") {
      assert.equal(values[2], state.match.id);
      state.rows = state.rows.map((item) => item.id === values[3] ? { ...item, attendanceStatus: values[0] as MatchPlayer["attendanceStatus"], updatedAt: values[1] as string } : item);
      return [];
    }
    if (statement === "update matches set status = ?, updated_at = ? where id = ?") {
      assert.equal(values[2], state.match.id);
      if (failMatchWrite) throw new Error("fixture: cierre fallido");
      state.match = { ...state.match, status: values[0] as Match["status"], updatedAt: values[1] as string };
      return [];
    }
    throw new Error(`SQL inesperado en fixture: ${statement}`);
  };
  const sql = { begin: async (callback: (tx: typeof query) => Promise<unknown>) => {
    const before = structuredClone(state);
    try { return await callback(query); } catch (error) { state = before; throw error; }
  } };
  const repository = loadCloseModule("./repository.ts", {
    "./db": { hasDatabaseUrl: () => true, getSql: () => sql },
    "./store": { planRosterClose, rosterCloseProposal },
  }) as Pick<typeof import("./repository"), "closeMatchRoster">;
  return { repository, queries, state: () => state };
}

for (const choice of ["include", "exclude"] as const) {
  test(`transacción ${choice}: locks y conservación exacta de todos los demás campos`, async () => {
    const context = closeRepositoryFixture();
    const before = structuredClone(context.state());
    const proposal = rosterCloseProposal(before.match, before.rows);
    const result = await context.repository.closeMatchRoster(before.match.id, proposal.snapshot, choice);
    assert.equal(result.status, "closed");
    if (result.status !== "closed") throw new Error("Se esperaba cierre");
    assert.equal(result.playerUpdates.length, choice === "include" ? 2 : 0);
    assert.equal(context.state().match.status, "roster_locked");
    assert.deepEqual({ ...context.state().match, status: before.match.status, updatedAt: before.match.updatedAt }, before.match);
    for (const original of before.rows) {
      const actual = context.state().rows.find((item) => item.id === original.id)!;
      const promoted = result.playerUpdates.some((item) => item.id === original.id);
      assert.deepEqual(actual, promoted ? { ...original, attendanceStatus: "confirmed", updatedAt: result.updatedAt } : original);
    }
    assert.match(context.queries[0], /from matches .*for update$/);
    assert.match(context.queries[1], /from match_players .*for update$/);
    assert.equal(context.queries.filter((statement) => statement.startsWith("update")).length, result.playerUpdates.length + 1);
  });
}

test("transacción: propuesta obsoleta no escribe; fallo al cerrar revierte promociones", async () => {
  const stale = closeRepositoryFixture();
  const staleBefore = structuredClone(stale.state());
  const result = await stale.repository.closeMatchRoster(staleBefore.match.id, "snapshot anterior", "include");
  assert.equal(result.status, "changed");
  assert.equal(stale.queries.length, 2);
  assert.deepEqual(stale.state(), staleBefore);
  const failing = closeRepositoryFixture(true);
  const before = structuredClone(failing.state());
  await assert.rejects(failing.repository.closeMatchRoster(before.match.id, rosterCloseProposal(before.match, before.rows).snapshot, "include"), /cierre fallido/);
  assert.deepEqual(failing.state(), before);
});

test("Server Action exige permiso matches, valida decisión y revalida solo tras éxito", async () => {
  const context = closeRepositoryFixture();
  const permissions: string[] = [];
  const revalidated: string[] = [];
  let allowed = false;
  const actions = loadCloseModule("../app/actions.ts", {
    "@/lib/repository": context.repository,
    "@/lib/auth": { requirePermission: async (permission: string) => { permissions.push(permission); if (!allowed) throw new Error("fixture: sin permiso"); } },
    "next/cache": { revalidatePath: (path: string) => revalidated.push(path) },
  }) as Pick<typeof import("../app/actions"), "closeMatchRosterAction">;
  const { match, rows } = context.state();
  const snapshot = rosterCloseProposal(match, rows).snapshot;
  await assert.rejects(actions.closeMatchRosterAction(match.id, snapshot, "include"), /sin permiso/);
  allowed = true;
  await assert.rejects(actions.closeMatchRosterAction(match.id, snapshot, "invalid" as RosterCloseChoice), /no es válida/);
  await assert.rejects(actions.closeMatchRosterAction("", snapshot, "include"), /no es válida/);
  assert.deepEqual(context.queries, []);
  assert.equal((await actions.closeMatchRosterAction(match.id, "old", "exclude")).status, "changed");
  assert.equal(revalidated.length, 0);
  assert.equal((await actions.closeMatchRosterAction(match.id, snapshot, "exclude")).status, "closed");
  assert.ok(permissions.every((permission) => permission === "matches"));
  assert.ok(revalidated.includes(`/matches/${match.id}`));
});

test("diálogo: nombres exactos, cupos, ambas CTA, Cancelar y Esc sin confirmaciones", () => {
  const react = fixtureRequire("react");
  const refs: { current: unknown }[] = [];
  const effects: (() => (() => void) | undefined)[] = [];
  class FocusTarget {
    isConnected = true;
    disabled = false;
    focused = 0;
    matches() { return this.disabled; }
    focus() { this.focused++; }
  }
  const trigger = new FocusTarget();
  const fallback = new FocusTarget();
  const workspace = loadCloseModule("../components/admin/SifupWorkspace.tsx", {
    react: { ...react, useRef: () => { const ref = { current: null }; refs.push(ref); return ref; }, useId: () => "close-fixture", useEffect: (effect: typeof effects[number]) => effects.push(effect) },
    "react/jsx-runtime": fixtureRequire("react/jsx-runtime"),
    document: { activeElement: trigger },
    HTMLElement: FocusTarget,
  }, "export { CloseRosterDialog };") as { CloseRosterDialog: (props: Record<string, unknown>) => ReactElement };
  const { match, rows } = closeFixture(12, 1);
  const proposal: RosterCloseProposal = rosterCloseProposal(match, rows);
  const choices: string[] = [];
  let cancellations = 0;
  const props = { proposal, pending: false, error: "", returnFocusRef: { current: fallback }, onConfirm: (choice: string) => choices.push(choice), onCancel: () => { cancellations++; } };
  const dialog = workspace.CloseRosterDialog(props);
  let opened = 0;
  let closed = 0;
  const heading = new FocusTarget();
  refs[0].current = { showModal: () => { opened++; }, close: () => { closed++; } };
  refs[1].current = heading;
  effects[0]()!();
  assert.equal(opened, 1);
  assert.equal(closed, 1);
  assert.equal(heading.focused, 1);
  assert.equal(trigger.focused, 1);
  trigger.disabled = true;
  effects[0]()!();
  assert.equal(fallback.focused, 1);
  const html = renderToStaticMarkup(dialog);
  assert.match(html, /aria-labelledby="close-fixture"/);
  assert.match(html, /Espera 0/);
  assert.match(html, /quedarían 1 cupos libres/);
  assert.match(html, /Incluir y cerrar lista/);
  assert.match(html, /Cerrar sin incluir/);
  const nodes: ReactElement<Record<string, unknown>>[] = [];
  function visit(element: ReactElement) {
    const node = element as ReactElement<Record<string, unknown>>;
    nodes.push(node);
    Children.forEach(node.props.children as React.ReactNode, (child) => { if (isValidElement(child)) visit(child); });
  }
  visit(dialog);
  const buttons = nodes.filter((node) => typeof node.type === "function");
  (buttons[0].props.onClick as () => void)();
  (buttons[1].props.onClick as () => void)();
  assert.deepEqual(choices, ["include", "exclude"]);
  choices.length = 0;
  (buttons[2].props.onClick as () => void)();
  let prevented = false;
  const cancel = (dialog.props as { onCancel: (event: { preventDefault: () => void }) => void }).onCancel;
  cancel({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(cancellations, 2);
  assert.deepEqual(choices, []);
  const pendingDialog = workspace.CloseRosterDialog({ ...props, pending: true });
  (pendingDialog.props as { onCancel: typeof cancel }).onCancel({ preventDefault: () => {} });
  assert.equal(cancellations, 2);
  const pendingHtml = renderToStaticMarkup(pendingDialog);
  assert.equal((pendingHtml.match(/disabled=""/g) ?? []).length, 3);
});

function closePageData({ match, rows }: ReturnType<typeof closeFixture>): SifupData {
  return {
    matches: [{ ...match, date: match.date ?? "2099-07-01", time: match.time ?? "21:00", location: match.location ?? "Fixture" }],
    matchPlayers: rows, players: [], results: [], matchTeams: [], matchGames: [], monthlyPayments: [], clubExpenses: [], courtPayments: [],
    clubFinance: {} as SifupData["clubFinance"],
  };
}

function closePageHarness(initialData: SifupData, action: typeof import("../app/actions")["closeMatchRosterAction"]) {
  const hooks: unknown[] = [];
  const tasks: Promise<void>[] = [];
  let cursor = 0;
  let changed = false;
  let reloads = 0;
  let refreshes = 0;
  let unexpectedWrites = 0;
  function useState<Value>(initial: Value | (() => Value)) {
    const index = cursor++;
    if (index === hooks.length) hooks.push(typeof initial === "function" ? (initial as () => Value)() : initial);
    return [hooks[index] as Value, (next: Value | ((previous: Value) => Value)) => {
      const value = typeof next === "function" ? (next as (previous: Value) => Value)(hooks[index] as Value) : next;
      if (!Object.is(hooks[index], value)) { hooks[index] = value; changed = true; }
    }] as const;
  }
  const unexpectedWrite = async () => { unexpectedWrites++; throw new Error("Escritura inesperada en fixture"); };
  const workspace = loadCloseModule("../components/admin/SifupWorkspace.tsx", {
    react: {
      ...fixtureRequire("react"), useState,
      useRef: (initial: unknown) => useState({ current: initial })[0],
      useMemo: (calculate: () => unknown) => calculate(), useId: () => "close-page-fixture", useEffect: () => {},
      useTransition: () => [false, (task: () => Promise<void>) => { tasks.push(task()); }],
    },
    "react/jsx-runtime": fixtureRequire("react/jsx-runtime"),
    "@/lib/store": fixtureRequire("./store.ts"),
    "@/lib/sifup-constants": fixtureRequire("./sifup-constants.ts"),
    "@/lib/whatsapp": { teamsMessage: () => "", matchSummaryMessage: () => "" },
    "./AuthMode": { useIsAdmin: () => true },
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "@/app/actions": { closeMatchRosterAction: action, updateMatchAction: unexpectedWrite, saveMatchDetailAction: unexpectedWrite },
    window: { location: { reload: () => { reloads++; } } },
  }, "export { CloseRosterDialog };") as {
    MatchDetailPage: (props: { id: string; initialData: SifupData }) => ReactElement;
    CloseRosterDialog: (props: Record<string, unknown>) => ReactElement<Record<string, unknown>>;
  };
  return {
    render(data = initialData) {
      for (let attempt = 0; attempt < 3; attempt++) {
        cursor = 0;
        changed = false;
        const tree = workspace.MatchDetailPage({ id: data.matches[0].id, initialData: data });
        if (!changed) return tree;
      }
      throw new Error("Render de fixture no se estabilizó");
    },
    settle: () => Promise.all(tasks.splice(0)),
    dialog: workspace.CloseRosterDialog,
    counts: () => ({ reloads, refreshes, unexpectedWrites }),
  };
}

function closePageNodes(element: ReactElement): ReactElement<Record<string, unknown>>[] {
  const node = element as ReactElement<Record<string, unknown>>;
  const descendants: ReactElement<Record<string, unknown>>[] = [];
  Children.forEach(node.props.children as React.ReactNode, (child) => { if (isValidElement(child)) descendants.push(...closePageNodes(child)); });
  return [node, ...descendants];
}

function closePageText(children: React.ReactNode): string {
  return Children.toArray(children).map((child) => isValidElement<{ children?: React.ReactNode }>(child) ? closePageText(child.props.children) : String(child)).join("");
}

function closePageButton(tree: ReactElement, label: string) {
  const node = closePageNodes(tree).find((item) => typeof item.props.onClick === "function" && closePageText(item.props.children as React.ReactNode) === label);
  assert.ok(node, `Falta acción ${label}`);
  return node.props as { onClick: () => void; disabled: boolean };
}

for (const choice of ["include", "exclude", "normal"] as const) {
  test(`UI real ${choice}: guarda tras persistir y perder respuesta; solo recarga permite releer`, async () => {
    const context = closeRepositoryFixture();
    if (choice === "normal") context.state().rows = context.state().rows.filter((item) => item.attendanceStatus === "confirmed");
    const initialData = closePageData(context.state());
    let attempts = 0;
    const action: typeof import("../app/actions")["closeMatchRosterAction"] = async (...args) => {
      attempts++;
      const result = await context.repository.closeMatchRoster(...args);
      assert.equal(result.status, "closed");
      throw new Error("detalle interno que no debe mostrarse");
    };
    const page = closePageHarness(initialData, action);
    const firstClick = closePageButton(page.render(), "Cerrar lista").onClick;
    firstClick();
    firstClick();
    let confirmAgain = firstClick;
    let escape = () => {};
    if (choice !== "normal") {
      const modal = closePageNodes(page.render()).find((node) => node.type === page.dialog)!;
      assert.ok(modal);
      confirmAgain = () => (modal.props.onConfirm as (decision: RosterCloseChoice) => void)(choice);
      const nativeDialog = page.dialog(modal.props);
      escape = () => (nativeDialog.props.onCancel as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
      confirmAgain();
      confirmAgain();
    }
    await page.settle();
    assert.equal(attempts, 1);
    assert.equal(context.state().match.status, "roster_locked");
    const queriesAfterCommit = context.queries.length;
    let tree = page.render();
    const message = "No pudimos confirmar el resultado del cierre. Recarga la pagina para comprobar si la lista quedo cerrada antes de volver a intentar.";
    assert.ok(closePageText(tree).includes(message));
    assert.equal(closePageText(tree).includes("detalle interno"), false);
    assert.equal(closePageButton(tree, "Cerrar lista").disabled, true);
    assert.equal(closePageNodes(tree).some((node) => node.type === page.dialog), false);
    escape();
    confirmAgain();
    firstClick();
    closePageButton(tree, "Cerrar lista").onClick();
    await page.settle();
    tree = page.render(structuredClone(initialData));
    assert.ok(closePageText(tree).includes(message));
    assert.equal(attempts, 1);
    assert.equal(context.queries.length, queriesAfterCommit);
    assert.deepEqual(page.counts(), { reloads: 0, refreshes: 0, unexpectedWrites: 0 });
    closePageButton(tree, "Recargar partido").onClick();
    firstClick();
    await page.settle();
    assert.equal(attempts, 1);
    assert.equal(page.counts().reloads, 1);
    const remounted = closePageHarness(closePageData(structuredClone(context.state())), action);
    const reread = remounted.render();
    assert.ok(closePageText(reread).includes("Lista cerrada ("));
    assert.ok(closePageText(reread).includes("Re-cerrar lista"));
    assert.equal(closePageText(reread).includes(message), false);
    assert.equal(attempts, 1);
  });
}

for (const status of ["changed", "reload"] as const) {
  test(`UI real: respuesta conocida ${status} no activa la guarda incierta`, async () => {
    const context = closeFixture(12, 0);
    const proposal = rosterCloseProposal(context.match, closeFixture().rows);
    let attempts = 0;
    const page = closePageHarness(closePageData(context), async () => {
      attempts++;
      return status === "changed" ? { status, proposal } : { status, message: "Recarga el partido" };
    });
    closePageButton(page.render(), "Cerrar lista").onClick();
    await page.settle();
    const tree = page.render();
    assert.equal(closePageText(tree).includes("No pudimos confirmar"), false);
    if (status === "changed") {
      const modal = closePageNodes(tree).find((node) => node.type === page.dialog)!;
      assert.ok(modal);
      (modal.props.onConfirm as (decision: RosterCloseChoice) => void)("exclude");
    } else {
      assert.equal(page.counts().refreshes, 1);
      closePageButton(tree, "Cerrar lista").onClick();
    }
    await page.settle();
    assert.equal(attempts, 2);
  });
}
