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
import { TradeForm, TradesTable, FiltersBar, JournalPanel, PlaybookPanel, CashflowPanel, TimezonePicker, AuthGate, ProfilePanel, ErrorBoundary } from "./App";
import { computeTrade, DEFAULT_FILTERS, DEFAULT_PREFERENCES, DEFAULT_SETTINGS, fmtDate, parseLocalInputValue, toLocalInputValue, timezoneOptions } from "./lib/trade";
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

  /* The totals row is what a filter is *for*: the table is handed the filtered
     trades, so this has to total exactly what is on screen — including across
     pages, and with the money under its own column whatever is hidden. */
  it("totals the whole filtered set, not just the visible page", () => {
    const trades = [
      closedTrade("TJ-00001", "BTCUSDT", "110"), // +10
      closedTrade("TJ-00002", "EURUSD", "90"),   // -10
      closedTrade("TJ-00003", "XAUUSD", "130"),  // +30
    ];
    const { container } = render(<TradesTable {...tableProps(trades, { initialPageSize: 2 })} />);
    const foot = container.querySelector(".trades-total");

    expect(container.querySelectorAll("tbody tr")).toHaveLength(2); // one page
    expect(foot.textContent).toContain("3 trades shown");
    expect(foot.textContent).toContain("66.7% win rate");
    expect(foot.textContent).toContain("+$30.00");                  // 10 - 10 + 30
  });

  it("counts open trades separately and leaves them out of the P&L", () => {
    const open = computeTrade({
      id: "TJ-00009", symbol: "NAS100", direction: "Long", status: "Open", marketType: "Crypto", grade: "B",
      entryPrice: "100", positionSize: "1", entryDateTime: "2026-07-10T09:00",
    });
    const { container } = render(<TradesTable {...tableProps([closedTrade("TJ-00001", "BTCUSDT", "110"), open])} />);
    const foot = container.querySelector(".trades-total").textContent;
    expect(foot).toContain("2 trades shown");
    expect(foot).toContain("1 closed");
    expect(foot).toContain("1 open");
    expect(foot).toContain("+$10.00");
  });

  it("keeps the totals under their own columns when a column is hidden", () => {
    const { container } = render(<TradesTable {...tableProps([closedTrade("TJ-00001", "BTCUSDT", "110")], { hiddenColumns: ["pnlPercent", "expectedRR"] })} />);
    const headCells = [...container.querySelectorAll("thead th")].length;
    const footRow = container.querySelector(".trades-total tr");
    const spanned = [...footRow.cells].reduce((n, c) => n + (c.colSpan || 1), 0);
    expect(spanned).toBe(headCells);
  });

  it("shows how long an open trade has been open", () => {
    const open = computeTrade({
      id: "TJ-00009", symbol: "NAS100", direction: "Long", status: "Open", marketType: "Crypto", grade: "B",
      entryPrice: "100", positionSize: "1",
      entryDateTime: toLocalInputValue(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000)),
    });
    const { container } = render(<TradesTable {...tableProps([open])} />);
    expect(container.querySelector(".cell-age").textContent).toBe("3d 2h");
  });
});

// The filters bar's chips: a collapsed panel that only says "Filters (3)" is
// why a short list reads as missing trades. describeFilters is proven in
// lib/trade.test.js; this asserts the bar renders one chip per filter and that
// removing one clears only that filter.
describe("FiltersBar — active filter chips", () => {
  const barProps = (filters, overrides = {}) => ({
    filters: { ...DEFAULT_FILTERS, ...filters },
    setFilters: vi.fn(),
    assets: ["BTCUSDT"], strategies: ["ICT"], tags: ["london"],
    ...overrides,
  });

  it("names every active filter", () => {
    render(<FiltersBar {...barProps({ status: "Open", asset: "BTCUSDT", result: "win" })} />);
    expect(screen.getByText("Open trades")).toBeTruthy();
    expect(screen.getByText("BTCUSDT")).toBeTruthy();
    expect(screen.getByText("Wins only")).toBeTruthy();
  });

  it("shows no chips when nothing is filtered", () => {
    const { container } = render(<FiltersBar {...barProps({})} />);
    expect(container.querySelector(".filter-chips")).toBeNull();
  });

  it("removing a chip clears that filter and leaves the others alone", async () => {
    const user = userEvent.setup();
    let patched;
    const setFilters = vi.fn((updater) => { patched = updater({ ...DEFAULT_FILTERS, asset: "BTCUSDT", strategy: "ICT" }); });
    render(<FiltersBar {...barProps({ asset: "BTCUSDT", strategy: "ICT" }, { setFilters })} />);

    await user.click(screen.getByRole("button", { name: /remove filter: BTCUSDT/i }));
    expect(patched).toMatchObject({ asset: "", strategy: "ICT" });
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
    const stats = [...container.querySelectorAll(".playbook-stats")].map((h) => h.textContent);
    expect(stats[0]).toContain("2 trades");
    expect(stats[1]).toContain("1 trade");
    // …and the note carries how recent the record behind it is.
    expect(container.querySelector(".playbook-count").textContent).toContain("Last closed");
  });

  it("prompts to add a strategy first when the list is empty", () => {
    render(<PlaybookPanel {...playbookProps({ strategies: [] })} />);
    expect(screen.getByText(/no strategies yet — add one with manage/i)).toBeTruthy();
  });

  // The stats row is the reason the tab exists: a plan read next to its result.
  const graded = (id, strategy, exitPrice) => computeTrade({
    id, symbol: "BTCUSDT", direction: "Long", status: "Closed", marketType: "Crypto", grade: "B",
    entryPrice: "100", exitPrice, positionSize: "1", stopLoss: "90",
    entryDateTime: "2026-07-10T09:00", exitDateTime: "2026-07-10T11:00", strategy,
  });

  it("shows each strategy's win rate and net P&L beside its note", () => {
    const { container } = render(<PlaybookPanel {...playbookProps({
      trades: [graded("TJ-1", "ICT", "110"), graded("TJ-2", "ICT", "95")],
    })} />);
    const stats = [...container.querySelectorAll(".playbook-card")][0].textContent;
    expect(stats).toContain("Win rate");
    expect(stats).toContain("50.0%");
    expect(stats).toContain("+$5.00");
  });

  it("searches strategy names and note text", async () => {
    const user = userEvent.setup();
    const { container } = render(<PlaybookPanel {...playbookProps({
      settings: { ...DEFAULT_SETTINGS, strategyNotes: { Scalping: "Liquidity sweep only." } },
    })} />);
    const names = () => [...container.querySelectorAll(".playbook-name")].map((n) => n.textContent);

    await user.type(screen.getByLabelText(/search strategies/i), "liquidity");
    expect(names()).toEqual(["Scalping"]);

    await user.clear(screen.getByLabelText(/search strategies/i));
    await user.type(screen.getByLabelText(/search strategies/i), "ict");
    expect(names()).toEqual(["ICT"]);
  });

  it("reorders by result when a sort is picked, without dropping untraded strategies", async () => {
    const user = userEvent.setup();
    const { container } = render(<PlaybookPanel {...playbookProps({ trades: [graded("TJ-1", "Scalping", "130")] })} />);
    const names = () => [...container.querySelectorAll(".playbook-name")].map((n) => n.textContent);

    expect(names()).toEqual(["ICT", "Scalping"]);
    await user.click(screen.getByRole("button", { name: /best p&l/i }));
    // Scalping has the only P&L; ICT has none at all and sorts last rather than
    // ranking as a zero.
    expect(names()).toEqual(["Scalping", "ICT"]);
  });

  it("opens the strategy manager from the panel's Manage button", async () => {
    const user = userEvent.setup();
    render(<PlaybookPanel {...playbookProps()} />);
    await user.click(screen.getByRole("button", { name: /manage/i }));
    expect(await screen.findByText(/manage strategies/i)).toBeTruthy();
  });
});

// The journal-timezone combobox. Ordering, grouping and matching are proven in
// lib/trade.test.js (timezoneOptions / filterTimezoneOptions / groupTimezoneOptions);
// these assert the widget around them — search narrows, keyboard selects, and the
// System row reports "" rather than the machine's zone id.
describe("TimezonePicker — searchable journal timezone", () => {
  const options = timezoneOptions(
    ["Asia/Kolkata", "America/New_York", "Europe/Paris", "Asia/Tokyo", "Asia/Kathmandu"],
    new Date("2026-07-15T12:00:00Z"),
  );
  const pickerProps = (overrides = {}) => ({ value: "", onChange: vi.fn(), options, systemTz: "Asia/Kolkata", ...overrides });

  const open = async (user) => user.click(screen.getByRole("button", { name: /journal timezone/i }));

  it("lists every zone under an ascending ladder of GMT headings", async () => {
    const user = userEvent.setup();
    const { container } = render(<TimezonePicker {...pickerProps()} />);
    await open(user);
    expect([...container.querySelectorAll(".tz-group")].map((g) => g.textContent))
      .toEqual(["-04:00 GMT", "+02:00 GMT", "+05:30 GMT", "+05:45 GMT", "+09:00 GMT"]);
  });

  it("narrows to a city as it is typed", async () => {
    const user = userEvent.setup();
    const { container } = render(<TimezonePicker {...pickerProps()} />);
    await open(user);
    await user.type(screen.getByLabelText(/search timezones/i), "tokyo");
    expect([...container.querySelectorAll(".tz-opt-city")].map((o) => o.textContent)).toEqual(["Tokyo"]);
  });

  it("narrows on a GMT offset written without its leading zero", async () => {
    const user = userEvent.setup();
    const { container } = render(<TimezonePicker {...pickerProps()} />);
    await open(user);
    await user.type(screen.getByLabelText(/search timezones/i), "+5:45");
    expect([...container.querySelectorAll(".tz-opt-city")].map((o) => o.textContent)).toEqual(["Kathmandu"]);
  });

  it("reports the picked zone id", async () => {
    const user = userEvent.setup();
    const props = pickerProps();
    render(<TimezonePicker {...props} />);
    await open(user);
    await user.click(screen.getByText("New York"));
    expect(props.onChange).toHaveBeenCalledWith("America/New_York");
  });

  it("selects with the keyboard, and reports System as \"\" not the machine's id", async () => {
    const user = userEvent.setup();
    const props = pickerProps({ value: "Asia/Tokyo" });
    render(<TimezonePicker {...props} />);
    await open(user);
    // The cursor opens on the selected zone; Home walks it back to the System row.
    await user.keyboard("{Home}{Enter}");
    expect(props.onChange).toHaveBeenCalledWith("");
  });

  it("keeps a zone this runtime does not list selectable rather than reading as System", async () => {
    render(<TimezonePicker {...pickerProps({ value: "Mars/Olympus" })} />);
    expect(screen.getByRole("button", { name: /journal timezone: mars\/olympus/i })).toBeTruthy();
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
    // The record comes back stamped with this sign-in — the profile reads it as
    // "last sign-in", so the gate is where it has to be set.
    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({ ...record, lastLoginAt: expect.any(String) }));
    expect(onAuthenticated.mock.calls[0][0].lastLoginAt).not.toBe("");
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

/* Sign-up at the gate. The rule being pinned is the one that keeps the gate
   worth having: with self-signup off, the tab is honest about *why* it can't
   create an account instead of quietly doing it anyway. */
describe("AuthGate — sign up", () => {
  const gate = (props = {}) => ({ users: [], journalName: "Trade Journal", onAuthenticated: vi.fn(), onRegister: vi.fn(), ...props });
  const openSignup = async (user) => user.click(screen.getByRole("tab", { name: /create account/i }));

  it("registers a first account even with self-signup off — that is how the gate gets turned on", async () => {
    const user = userEvent.setup();
    const props = gate();
    render(<AuthGate {...props} />);

    await openSignup(user);
    await user.type(screen.getByPlaceholderText(/pick a username/i), "brij");
    await user.type(screen.getByPlaceholderText(/shown on your profile/i), "Brij K");
    await user.type(screen.getByPlaceholderText(/at least 4 characters/i), "hunter2");
    await user.type(screen.getByPlaceholderText(/repeat password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /create account & sign in/i }));

    await vi.waitFor(() => expect(props.onRegister).toHaveBeenCalled());
    const created = props.onRegister.mock.calls[0][0];
    expect(created).toMatchObject({ username: "brij", displayName: "Brij K" });
    expect(created.hash).toBeTruthy();
    expect(created.hash).not.toContain("hunter2");
  });

  it("refuses to self-register past a gate that is already on", async () => {
    const user = userEvent.setup();
    const props = gate({ users: [await makeUser("brij", "hunter2")] });
    render(<AuthGate {...props} />);

    await openSignup(user);
    expect(screen.getByText(/self sign-up is switched off/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/pick a username/i)).toBeNull();
    expect(props.onRegister).not.toHaveBeenCalled();
  });

  it("lets a second person register once the owner allows it", async () => {
    const user = userEvent.setup();
    const props = gate({ users: [await makeUser("brij", "hunter2")], allowSignup: true });
    render(<AuthGate {...props} />);

    await openSignup(user);
    await user.type(screen.getByPlaceholderText(/pick a username/i), "sam");
    await user.type(screen.getByPlaceholderText(/at least 4 characters/i), "sam-pass");
    await user.type(screen.getByPlaceholderText(/repeat password/i), "sam-pass");
    await user.click(screen.getByRole("button", { name: /create account & sign in/i }));

    await vi.waitFor(() => expect(props.onRegister).toHaveBeenCalled());
    expect(props.onRegister.mock.calls[0][0].username).toBe("sam");
  });

  it("rejects a taken username and a mismatched confirmation, without registering", async () => {
    const user = userEvent.setup();
    const props = gate({ users: [await makeUser("brij", "hunter2")], allowSignup: true });
    render(<AuthGate {...props} />);

    await openSignup(user);
    await user.type(screen.getByPlaceholderText(/pick a username/i), "BRIJ");
    await user.type(screen.getByPlaceholderText(/at least 4 characters/i), "whatever");
    await user.type(screen.getByPlaceholderText(/repeat password/i), "whatever");
    await user.click(screen.getByRole("button", { name: /create account & sign in/i }));
    expect(await screen.findByText(/username is taken/i)).toBeTruthy();

    await user.clear(screen.getByPlaceholderText(/pick a username/i));
    await user.type(screen.getByPlaceholderText(/pick a username/i), "sam");
    await user.clear(screen.getByPlaceholderText(/repeat password/i));
    await user.type(screen.getByPlaceholderText(/repeat password/i), "different");
    await user.click(screen.getByRole("button", { name: /create account & sign in/i }));
    expect(await screen.findByText(/don't match/i)).toBeTruthy();
    expect(props.onRegister).not.toHaveBeenCalled();
  });
});

// The signed-in user's own page: what it shows, and the two things it can
// change. The password rules themselves are proven in lib/auth.test.js.
describe("ProfilePanel — the signed-in user", () => {
  const profileProps = async (overrides = {}) => ({
    user: { ...(await makeUser("brij", "hunter2")), displayName: "Brij K", createdAt: "2026-01-15T10:00" },
    users: [], onUpdateUser: vi.fn(), onSignOut: vi.fn(), onToast: vi.fn(), tradeCount: 42, journalName: "Trade Journal",
    ...overrides,
  });

  it("shows who is signed in, by display name over username", async () => {
    render(<ProfilePanel {...await profileProps()} />);
    expect(screen.getByRole("heading", { name: "Brij K" })).toBeTruthy();
    expect(screen.getByText("@brij")).toBeTruthy();
    expect(screen.getByText(/42 trades in Trade Journal/)).toBeTruthy();
  });

  it("falls back to the username when no display name is set", async () => {
    const props = await profileProps();
    render(<ProfilePanel {...props} user={{ ...props.user, displayName: "" }} />);
    expect(screen.getByRole("heading", { name: "brij" })).toBeTruthy();
  });

  it("saves a new display name and leaves the username alone", async () => {
    const user = userEvent.setup();
    const props = await profileProps();
    render(<ProfilePanel {...props} />);

    const name = screen.getByLabelText(/display name/i);
    await user.clear(name);
    await user.type(name, "Brij Trades");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect(props.onUpdateUser).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Brij Trades", username: "brij" }));
    // The username is the identity every record is keyed to — not editable here.
    expect(screen.getByLabelText(/^username$/i).readOnly).toBe(true);
  });

  it("changes the password only when the current one is right", async () => {
    const user = userEvent.setup();
    const props = await profileProps();
    render(<ProfilePanel {...props} />);

    await user.type(screen.getByPlaceholderText(/your current password/i), "wrong");
    await user.type(screen.getByPlaceholderText(/at least 4 characters/i), "new-secret");
    await user.type(screen.getByPlaceholderText(/repeat new password/i), "new-secret");
    await user.click(screen.getByRole("button", { name: /change password/i }));
    expect(await screen.findByText(/current password is incorrect/i)).toBeTruthy();
    expect(props.onUpdateUser).not.toHaveBeenCalled();

    await user.clear(screen.getByPlaceholderText(/your current password/i));
    await user.type(screen.getByPlaceholderText(/your current password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /change password/i }));
    await vi.waitFor(() => expect(props.onUpdateUser).toHaveBeenCalled());
    const saved = props.onUpdateUser.mock.calls[0][0];
    expect(saved.hash).not.toBe(props.user.hash);
    expect(saved.salt).not.toBe(props.user.salt);
  });

  it("catches a mistyped confirmation before touching the store", async () => {
    const user = userEvent.setup();
    const props = await profileProps();
    render(<ProfilePanel {...props} />);

    await user.type(screen.getByPlaceholderText(/your current password/i), "hunter2");
    await user.type(screen.getByPlaceholderText(/at least 4 characters/i), "new-secret");
    await user.type(screen.getByPlaceholderText(/repeat new password/i), "typo");
    await user.click(screen.getByRole("button", { name: /change password/i }));
    expect(await screen.findByText(/don't match/i)).toBeTruthy();
    expect(props.onUpdateUser).not.toHaveBeenCalled();
  });

  it("signs out on request", async () => {
    const user = userEvent.setup();
    const props = await profileProps();
    render(<ProfilePanel {...props} />);
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(props.onSignOut).toHaveBeenCalled();
  });

  it("lists the other logins only when there are any", async () => {
    const props = await profileProps();
    const { rerender } = render(<ProfilePanel {...props} />);
    expect(screen.queryByText(/who else can sign in/i)).toBeNull();

    rerender(<ProfilePanel {...props} users={[props.user, { ...props.user, id: "u2", username: "sam", displayName: "" }]} />);
    expect(screen.getByText(/who else can sign in/i)).toBeTruthy();
    expect(screen.getByText("@sam")).toBeTruthy();
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
