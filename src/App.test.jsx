// @vitest-environment jsdom
/**
 * Component smoke tests for the two highest-risk interactive pieces of the
 * shell: the trade form's validation gate (the only thing standing between a
 * half-filled form and a malformed trade on disk) and the trades table.
 *
 * Deliberately shallow — lib/trade.test.js owns the maths. These only assert
 * that the components wire those rules to the user: errors surface, saves fire
 * with the gate passed, destructive paths ask first. jsdom is per-file here
 * (the pragma above); the lib suite stays in plain Node.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TradeForm, TradesTable, JournalPanel, PlaybookPanel, CashflowPanel, AuthGate, ErrorBoundary } from "./App";
import { computeTrade, DEFAULT_PREFERENCES, DEFAULT_SETTINGS, fmtDate, parseLocalInputValue } from "./lib/trade";
import { makeUser } from "./lib/auth";

afterEach(cleanup);

const formProps = (overrides = {}) => ({
  onSave: vi.fn(),
  onClose: vi.fn(),
  strategies: ["ICT"],
  setStrategies: vi.fn(),
  lastDefaults: {},
  ...overrides,
});

// Fill the entry datetime through the picker: open it, take the seeded "now"
// draft, confirm. Queried by text, not role+name: the picker lives inside the
// Field <label>, and buttons are labelable elements, so every button in the
// popover inherits "Entry Date & Time" as its accessible name. Entry and exit
// both render the same empty-state trigger; entry is first in the form.
const pickEntryDateTime = async (user) => {
  await user.click(screen.getAllByText(/select date & time/i)[0]);
  await user.click(screen.getByText(/^confirm$/i));
};

describe("TradeForm — validation gate", () => {
  it("refuses to save without a symbol", async () => {
    const user = userEvent.setup();
    const props = formProps();
    render(<TradeForm {...props} />);
    await user.click(screen.getByRole("button", { name: /save trade/i }));
    expect(await screen.findByText(/symbol is required/i)).toBeTruthy();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("walks the gate in order: symbol, then entry price, then entry time", async () => {
    const user = userEvent.setup();
    const props = formProps();
    render(<TradeForm {...props} />);
    const save = screen.getByRole("button", { name: /save trade/i });

    await user.type(screen.getByLabelText(/symbol \/ asset/i), "BTCUSDT");
    await user.click(save);
    expect(await screen.findByText(/entry price is required/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/^entry price$/i), "65000");
    await user.click(save);
    expect(await screen.findByText(/entry date & time is required/i)).toBeTruthy();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("saves an open trade once symbol, entry price and entry time are set", async () => {
    const user = userEvent.setup();
    const props = formProps();
    render(<TradeForm {...props} />);

    await user.type(screen.getByLabelText(/symbol \/ asset/i), "BTCUSDT");
    await user.type(screen.getByLabelText(/^entry price$/i), "65000");
    await pickEntryDateTime(user);
    await user.click(screen.getByRole("button", { name: /save trade/i }));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    const saved = props.onSave.mock.calls[0][0];
    expect(saved.symbol).toBe("BTCUSDT");
    expect(saved.entryPrice).toBe("65000");
    expect(saved.status).toBe("Open");
  });

  it("requires an exit price before a trade may be saved as Closed", async () => {
    const user = userEvent.setup();
    const props = formProps();
    render(<TradeForm {...props} />);

    await user.type(screen.getByLabelText(/symbol \/ asset/i), "BTCUSDT");
    await user.type(screen.getByLabelText(/^entry price$/i), "65000");
    await pickEntryDateTime(user);
    await user.click(screen.getByRole("button", { name: /^closed$/i }));
    await user.click(screen.getByRole("button", { name: /save trade/i }));

    expect(await screen.findByText(/exit price is required for a closed trade/i)).toBeTruthy();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("guards unsaved edits behind a discard confirmation instead of closing", async () => {
    const user = userEvent.setup();
    const props = formProps();
    render(<TradeForm {...props} />);

    await user.type(screen.getByLabelText(/symbol \/ asset/i), "BTCUSDT");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(await screen.findByText(/unsaved changes/i)).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("TradesTable — smoke", () => {
  const closedTrade = (id, symbol, exitPrice) => computeTrade({
    id, symbol, direction: "Long", status: "Closed", marketType: "Crypto", grade: "B",
    entryPrice: "100", exitPrice, positionSize: "1",
    entryDateTime: "2026-07-10T09:00", exitDateTime: "2026-07-10T11:00",
  });
  const tableProps = (trades, overrides = {}) => ({
    trades,
    onView: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onCopy: vi.fn(),
    onBulkDelete: vi.fn(), onToast: vi.fn(), hiddenColumns: [],
    ...overrides,
  });

  it("renders a row per trade with its P&L", () => {
    render(<TradesTable {...tableProps([closedTrade("TJ-00001", "BTCUSDT", "110"), closedTrade("TJ-00002", "EURUSD", "90")])} />);
    expect(screen.getByText("BTCUSDT")).toBeTruthy();
    expect(screen.getByText("EURUSD")).toBeTruthy();
    expect(screen.getByText("+$10.00")).toBeTruthy();
    expect(screen.getByText("-$10.00")).toBeTruthy();
  });

  it("shows the empty state instead of a bare table when nothing matches", () => {
    render(<TradesTable {...tableProps([])} />);
    expect(screen.getByText(/no trades match the current filters/i)).toBeTruthy();
  });

  it("selecting a row raises the bulk bar; Delete asks the app, not storage", async () => {
    const user = userEvent.setup();
    const props = tableProps([closedTrade("TJ-00001", "BTCUSDT", "110")]);
    render(<TradesTable {...props} />);

    await user.click(screen.getByRole("checkbox", { name: /select tj-00001/i }));
    expect(await screen.findByText(/1 trade selected/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(props.onBulkDelete).toHaveBeenCalledWith(["TJ-00001"]);
  });

  it("applies a bulk edit from the selection bar's selects", async () => {
    const user = userEvent.setup();
    const props = tableProps([closedTrade("TJ-00001", "BTCUSDT", "110")], {
      accounts: [{ id: "a1", name: "Main" }, { id: "a2", name: "Prop Firm" }],
      strategies: ["ICT"],
      onBulkEdit: vi.fn(),
    });
    render(<TradesTable {...props} />);

    await user.click(screen.getByRole("checkbox", { name: /select tj-00001/i }));
    await user.selectOptions(screen.getByRole("combobox", { name: /move selected trades to account/i }), "a2");
    expect(props.onBulkEdit).toHaveBeenCalledWith(["TJ-00001"], { accountId: "a2" }, "moved to Prop Firm");

    await user.selectOptions(screen.getByRole("combobox", { name: /set strategy on selected trades/i }), "ICT");
    expect(props.onBulkEdit).toHaveBeenCalledWith(["TJ-00001"], { strategy: "ICT" }, "strategy set to ICT");
  });

  it("hides a switched-off column", () => {
    render(<TradesTable {...tableProps([closedTrade("TJ-00001", "BTCUSDT", "110")], { hiddenColumns: ["grade"] })} />);
    expect(screen.queryByText("Grade")).toBeNull();
  });

  // ServiceNow-style inline list edit: a per-cell pencil (and double-click)
  // commits a metadata change through onBulkEdit without opening the form.
  it("edits a cell inline through the hover pencil, routing to onBulkEdit", async () => {
    const user = userEvent.setup();
    const props = tableProps([closedTrade("TJ-00001", "BTCUSDT", "110")], { onBulkEdit: vi.fn() });
    render(<TradesTable {...props} />);

    // Grade: click the cell's Edit pencil, pick A from the inline select.
    await user.click(screen.getByRole("button", { name: /edit grade for tj-00001/i }));
    await user.selectOptions(screen.getByRole("combobox", { name: /grade for tj-00001/i }), "A");
    expect(props.onBulkEdit).toHaveBeenCalledWith(["TJ-00001"], { grade: "A" }, "grade set to A");
  });

  it("commits an inline symbol edit on Enter, upper-cased", async () => {
    const user = userEvent.setup();
    const props = tableProps([closedTrade("TJ-00001", "BTCUSDT", "110")], { onBulkEdit: vi.fn() });
    render(<TradesTable {...props} />);

    await user.click(screen.getByRole("button", { name: /edit symbol for tj-00001/i }));
    const input = screen.getByDisplayValue("BTCUSDT");
    await user.clear(input);
    await user.type(input, "ethusdt{Enter}");
    expect(props.onBulkEdit).toHaveBeenCalledWith(["TJ-00001"], { symbol: "ETHUSDT" }, "symbol set to ETHUSDT");
  });

  it("offers no inline editing when onBulkEdit is not wired", () => {
    render(<TradesTable {...tableProps([closedTrade("TJ-00001", "BTCUSDT", "110")])} />);
    expect(screen.queryByRole("button", { name: /edit symbol for/i })).toBeNull();
  });
});

// The Journal tab and the calendar's day notes edit the same
// preferences.dayNotes map — these only assert JournalPanel's own wiring onto
// that map (write, delete, list) and its trade-stats lookup; the map itself
// and the export formats are covered in lib/trade.test.js.
describe("JournalPanel — daily journal", () => {
  const closedTrade = (id, exitDateTime) => computeTrade({
    id, symbol: "BTCUSDT", direction: "Long", status: "Closed", marketType: "Crypto", grade: "B",
    entryPrice: "100", exitPrice: "110", positionSize: "1",
    entryDateTime: "2026-07-17T09:00", exitDateTime,
  });
  const journalProps = (overrides = {}) => ({
    trades: [],
    preferences: DEFAULT_PREFERENCES,
    setPreferences: vi.fn(),
    onSelectDay: vi.fn(),
    onToast: vi.fn(),
    ...overrides,
  });

  it("shows the empty state with no entries", () => {
    render(<JournalPanel {...journalProps()} />);
    // Grain-aware empty state (Daily grain is the default).
    expect(screen.getByText(/no daily entries yet/i)).toBeTruthy();
  });

  it("writes a new entry for the prefilled date through the same DayNoteModal the calendar uses", async () => {
    const user = userEvent.setup();
    const props = journalProps();
    render(<JournalPanel {...props} />);

    await user.click(screen.getByRole("button", { name: /write entry/i }));
    await user.type(screen.getByPlaceholderText(/market conditions/i), "Choppy session, stood aside.");
    await user.click(screen.getByRole("button", { name: /save note/i }));

    const updater = props.setPreferences.mock.calls.at(-1)[0];
    const next = updater(DEFAULT_PREFERENCES);
    expect(Object.values(next.dayNotes)).toEqual(["Choppy session, stood aside."]);
  });

  it("lists entries newest first, each with that day's trade stats", () => {
    const { container } = render(<JournalPanel {...journalProps({
      trades: [closedTrade("TJ-1", "2026-07-17T11:00")],
      preferences: { ...DEFAULT_PREFERENCES, dayNotes: { "2026-07-15": "Stood aside.", "2026-07-17": "Took the trade." } },
    })} />);

    // fmtDate's rendering is locale-dependent (day-month-year on this machine's
    // default locale) — compare against the same helper rather than a literal
    // string, and rely on document order for "newest first".
    const heads = [...container.querySelectorAll(".journal-entry-head")].map((h) => h.textContent);
    expect(heads[0]).toContain(fmtDate(parseLocalInputValue("2026-07-17")));
    expect(heads[0]).toMatch(/1 trade/);
    expect(heads[0]).toContain("+$10.00");
    expect(heads[1]).toContain(fmtDate(parseLocalInputValue("2026-07-15")));
    expect(heads[1]).toMatch(/no closed trades/i);
  });

  it("'View trades' hands the day key to onSelectDay", async () => {
    const user = userEvent.setup();
    const props = journalProps({
      trades: [closedTrade("TJ-1", "2026-07-17T11:00")],
      preferences: { ...DEFAULT_PREFERENCES, dayNotes: { "2026-07-17": "Took the trade." } },
    });
    render(<JournalPanel {...props} />);

    await user.click(screen.getByRole("button", { name: /view trades/i }));
    expect(props.onSelectDay).toHaveBeenCalledWith("2026-07-17");
  });

  it("deleting an entry clears its text rather than dropping the key silently", async () => {
    const user = userEvent.setup();
    const props = journalProps({ preferences: { ...DEFAULT_PREFERENCES, dayNotes: { "2026-07-17": "Took the trade." } } });
    render(<JournalPanel {...props} />);

    await user.click(screen.getByRole("button", { name: /delete entry for 2026-07-17/i }));
    // Confirm copy names the day in the grain's display label, not the raw key.
    const dayLabel = fmtDate(parseLocalInputValue("2026-07-17"));
    expect(await screen.findByText(new RegExp(`delete the note for ${dayLabel}`, "i"))).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    const updater = props.setPreferences.mock.calls.at(-1)[0];
    const next = updater({ dayNotes: { "2026-07-17": "Took the trade." } });
    expect(next.dayNotes["2026-07-17"]).toBe("");
  });

  it("only offers export once there is something to export", () => {
    const { rerender } = render(<JournalPanel {...journalProps()} />);
    ["markdown", "csv", "word", "pdf"].forEach((name) => {
      expect(screen.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).disabled).toBe(true);
    });

    rerender(<JournalPanel {...journalProps({ preferences: { ...DEFAULT_PREFERENCES, dayNotes: { "2026-07-17": "Note." } } })} />);
    ["markdown", "csv", "word", "pdf"].forEach((name) => {
      expect(screen.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).disabled).toBe(false);
    });
  });

  // The filter row is collapsed until the Filter button opens it — it only
  // earns its space once asked for.
  it("keeps the filter row hidden until the Filter button opens it", async () => {
    const user = userEvent.setup();
    render(<JournalPanel {...journalProps({ preferences: { ...DEFAULT_PREFERENCES, dayNotes: { "2026-07-17": "Trend day." } } })} />);
    expect(screen.queryByLabelText(/search notes/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: /^filter$/i }));
    expect(screen.getByLabelText(/search notes/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^filter$/i }));
    expect(screen.queryByLabelText(/search notes/i)).toBeNull();
  });

  it("filters the visible entries by note text and offers a clear chip", async () => {
    const user = userEvent.setup();
    render(<JournalPanel {...journalProps({
      preferences: { ...DEFAULT_PREFERENCES, dayNotes: { "2026-07-17": "Trend day.", "2026-07-15": "Chop, stood aside." } },
    })} />);
    expect(document.querySelectorAll(".journal-entry")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /^filter$/i }));
    await user.type(screen.getByLabelText(/search notes/i), "chop");
    expect(document.querySelectorAll(".journal-entry")).toHaveLength(1);
    expect(screen.getByText(/clear \(1 of 2\)/i)).toBeTruthy();
    // The toolbar Filter button carries the narrowed count while active.
    expect(screen.getByRole("button", { name: /filter \(1\/2\)/i })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /clear \(1 of 2\)/i }));
    expect(document.querySelectorAll(".journal-entry")).toHaveLength(2);
  });

  it("shows a no-match state instead of the empty state when the filter excludes everything", async () => {
    const user = userEvent.setup();
    render(<JournalPanel {...journalProps({ preferences: { ...DEFAULT_PREFERENCES, dayNotes: { "2026-07-17": "Trend day." } } })} />);
    await user.click(screen.getByRole("button", { name: /^filter$/i }));
    await user.type(screen.getByLabelText(/search notes/i), "nothing matches this");
    expect(screen.getByText(/no entries match this filter/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^pdf$/i }).disabled).toBe(true);
  });

  // The grain switch (Daily/Weekly/Yearly) picks which note store the section
  // reads and writes — each grain has its own empty state and its own store.
  it("switches to the weekly grain and writes into weekNotes, not dayNotes", async () => {
    const user = userEvent.setup();
    const props = journalProps({ preferences: { ...DEFAULT_PREFERENCES, weekNotes: { "2026-W29": "Trend week." } } });
    render(<JournalPanel {...props} />);

    // Daily is the default and starts empty.
    expect(screen.getByText(/no daily entries yet/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^weekly$/i }));
    expect(screen.getByText(/trend week\./i)).toBeTruthy();

    // The add button reads "Write entry" or "Edit entry" depending on whether
    // the prefilled (current) week already has a note — either way it opens the
    // weekly DayNoteModal.
    await user.click(screen.getByRole("button", { name: /^(write|edit) entry$/i }));
    await user.type(screen.getByPlaceholderText(/how the week went/i), "Week recap.");
    await user.click(screen.getByRole("button", { name: /save note/i }));

    const updater = props.setPreferences.mock.calls.at(-1)[0];
    const next = updater(DEFAULT_PREFERENCES);
    // The write lands on weekNotes (a week-shaped key); dayNotes is untouched.
    expect(Object.keys(next.weekNotes).some((k) => /^\d{4}-W\d{2}$/.test(k))).toBe(true);
    expect(next.dayNotes).toEqual(DEFAULT_PREFERENCES.dayNotes);
  });

  it("shows a grain-specific empty state on the yearly grain", async () => {
    const user = userEvent.setup();
    render(<JournalPanel {...journalProps()} />);
    await user.click(screen.getByRole("button", { name: /^yearly$/i }));
    expect(screen.getByText(/no yearly entries yet/i)).toBeTruthy();
  });
});

// The playbook is settings.strategyNotes, name -> text, on its own tab.
// These assert the per-strategy field wiring; normalization (blank-dropping,
// length cap) is covered in lib/trade.test.js.
describe("PlaybookPanel — Strategy Playbook", () => {
  const playbookProps = (overrides = {}) => ({
    settings: DEFAULT_SETTINGS,
    setSettings: vi.fn(),
    strategies: ["ICT", "Scalping"],
    setStrategies: vi.fn(),
    trades: [],
    ...overrides,
  });

  it("shows one note field per strategy, prefilled from settings", () => {
    render(<PlaybookPanel {...playbookProps({ settings: { ...DEFAULT_SETTINGS, strategyNotes: { ICT: "Liquidity sweep entry." } } })} />);
    expect(screen.getByLabelText("ICT").value).toBe("Liquidity sweep entry.");
    expect(screen.getByLabelText("Scalping").value).toBe("");
  });

  it("edits one strategy's note without touching another's", () => {
    // setSettings must run its functional updater synchronously inside this
    // mock, not have the result read back later: React reverts a controlled
    // textarea's DOM value to its (unchanged) prop right after the change
    // event, and reading e.target.value after that point reads the reverted
    // "", not what was typed.
    let captured;
    const setSettings = vi.fn((updater) => { captured = updater({ strategyNotes: { ICT: "Old note" } }); });
    render(<PlaybookPanel {...playbookProps({ settings: { ...DEFAULT_SETTINGS, strategyNotes: { ICT: "Old note" } }, setSettings })} />);

    fireEvent.change(screen.getByLabelText("Scalping"), { target: { value: "Quick in and out." } });

    expect(captured.strategyNotes).toEqual({ ICT: "Old note", Scalping: "Quick in and out." });
  });

  it("counts the trades logged with each strategy", () => {
    const trade = (id, strategy) => computeTrade({
      id, symbol: "BTCUSDT", direction: "Long", status: "Closed", marketType: "Crypto", grade: "B",
      entryPrice: "100", exitPrice: "110", positionSize: "1",
      entryDateTime: "2026-07-10T09:00", exitDateTime: "2026-07-10T11:00", strategy,
    });
    const { container } = render(<PlaybookPanel {...playbookProps({ trades: [trade("TJ-1", "ICT"), trade("TJ-2", "ICT"), trade("TJ-3", "Scalping")] })} />);
    const hints = [...container.querySelectorAll(".playbook-count")].map((h) => h.textContent);
    expect(hints[0]).toContain("2 trades logged");
    expect(hints[1]).toContain("1 trade logged");
  });

  it("prompts to add a strategy first when the list is empty", () => {
    render(<PlaybookPanel {...playbookProps({ strategies: [] })} />);
    expect(screen.getByText(/no strategies yet — add one with manage/i)).toBeTruthy();
  });

  it("opens the strategy manager from the panel's Manage button", async () => {
    const user = userEvent.setup();
    render(<PlaybookPanel {...playbookProps()} />);
    await user.click(screen.getByRole("button", { name: /manage/i }));
    expect(await screen.findByText(/manage strategies/i)).toBeTruthy();
  });
});

// The cashflow tab: deposits/withdrawals with a running balance and its own
// filter. The maths (normalize/net/filter/sort) is proven in lib/trade.test.js;
// these assert the panel wires them to the user and writes to settings.transactions.
describe("CashflowPanel — deposits & withdrawals", () => {
  const accounts = [{ id: "acct-main", name: "Main", startingBalance: 0 }];
  const cashProps = (overrides = {}) => ({
    settings: { ...DEFAULT_SETTINGS, transactions: [], accounts },
    setSettings: vi.fn(),
    accounts,
    activeAccountId: "",
    startingBalance: 0,
    tradesNet: 0,
    onToast: vi.fn(),
    ...overrides,
  });

  it("shows the empty state with no transactions", () => {
    render(<CashflowPanel {...cashProps()} />);
    expect(screen.getByText(/no deposits or withdrawals yet/i)).toBeTruthy();
  });

  it("records a deposit into settings.transactions with the amount stored positive", async () => {
    const user = userEvent.setup();
    const props = cashProps();
    render(<CashflowPanel {...props} />);

    // Empty state shows two "New Transaction" buttons (toolbar + action); either opens the modal.
    await user.click(screen.getAllByRole("button", { name: /new transaction/i })[0]);
    await user.type(screen.getByLabelText(/amount/i), "1500");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    const updater = props.setSettings.mock.calls.at(-1)[0];
    const next = updater({ ...DEFAULT_SETTINGS, transactions: [] });
    expect(next.transactions).toHaveLength(1);
    expect(next.transactions[0]).toMatchObject({ type: "deposit", amount: 1500 });
  });

  it("lists transactions with a running balance and the true account balance card", () => {
    render(<CashflowPanel {...cashProps({
      startingBalance: 0, tradesNet: 200,
      settings: { ...DEFAULT_SETTINGS, accounts, transactions: [
        { id: "d1", type: "deposit", amount: 1000, date: "2026-07-01", accountId: "acct-main" },
        { id: "w1", type: "withdrawal", amount: 300, date: "2026-07-10", accountId: "acct-main" },
      ] },
    })} />);
    // Account Balance = starting 0 + trades 200 + cash (1000 − 300) = 900.
    expect(screen.getByText("$900.00")).toBeTruthy();
    // Newest row (withdrawal) leaves a running cash balance of 700.
    expect(screen.getByText("$700.00")).toBeTruthy();
  });

  it("filters the list to deposits only, behind the Filter toggle", async () => {
    const user = userEvent.setup();
    render(<CashflowPanel {...cashProps({
      settings: { ...DEFAULT_SETTINGS, accounts, transactions: [
        { id: "d1", type: "deposit", amount: 1000, date: "2026-07-01", accountId: "acct-main" },
        { id: "w1", type: "withdrawal", amount: 300, date: "2026-07-10", accountId: "acct-main" },
      ] },
    })} />);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /^filter/i }));
    await user.selectOptions(screen.getByLabelText(/^type$/i), "deposit");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
  });
});

// The login gate. Password hashing is proven in lib/auth.test.js; this asserts
// the screen verifies against the store and only lets a correct password in.
describe("AuthGate — login", () => {
  it("rejects a wrong password and admits the right one", async () => {
    const user = userEvent.setup();
    const record = await makeUser("brij", "hunter2");
    const onAuthenticated = vi.fn();
    render(<AuthGate users={[record]} journalName="Trade Journal" onAuthenticated={onAuthenticated} />);

    // Single user prefills the username; just enter the password.
    await user.type(screen.getByPlaceholderText(/your password/i), "wrongpw");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/incorrect password/i)).toBeTruthy();
    expect(onAuthenticated).not.toHaveBeenCalled();

    await user.clear(screen.getByPlaceholderText(/your password/i));
    await user.type(screen.getByPlaceholderText(/your password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(record));
  });

  it("rejects an unknown username", async () => {
    const user = userEvent.setup();
    const record = await makeUser("brij", "hunter2");
    const onAuthenticated = vi.fn();
    render(<AuthGate users={[record, { ...record, id: "u2", username: "other" }]} journalName="TJ" onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByPlaceholderText(/your username/i), "nobody");
    await user.type(screen.getByPlaceholderText(/your password/i), "whatever");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/no account with that username/i)).toBeTruthy();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});

// A render throw anywhere below the boundary must show the fallback screen
// instead of an uncaught error taking the whole tree down (the white-screen
// case the boundary exists to prevent), and must not swallow the error.
describe("ErrorBoundary — render-throw fallback", () => {
  const Bomb = () => {
    throw new Error("boom");
  };

  it("renders the fallback screen and logs the error instead of crashing", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText(/something went wrong/i)).toBeTruthy();
    expect(screen.getByText(/boom/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /reload/i })).toBeTruthy();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("all good")).toBeTruthy();
  });
});
