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
import { TradeForm, TradesTable, JournalPanel, SettingsPanel } from "./App";
import { computeTrade, DEFAULT_PREFERENCES, DEFAULT_SETTINGS, fmtDate, parseLocalInputValue } from "./lib/trade";

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
    expect(screen.getByText(/no journal entries yet/i)).toBeTruthy();
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
    expect(await screen.findByText(/delete the note for 2026-07-17/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    const updater = props.setPreferences.mock.calls.at(-1)[0];
    const next = updater({ dayNotes: { "2026-07-17": "Took the trade." } });
    expect(next.dayNotes["2026-07-17"]).toBe("");
  });

  it("only offers export once there is something to export", () => {
    const { rerender } = render(<JournalPanel {...journalProps()} />);
    expect(screen.getByRole("button", { name: /markdown/i }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /^csv$/i }).disabled).toBe(true);

    rerender(<JournalPanel {...journalProps({ preferences: { ...DEFAULT_PREFERENCES, dayNotes: { "2026-07-17": "Note." } } })} />);
    expect(screen.getByRole("button", { name: /markdown/i }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: /^csv$/i }).disabled).toBe(false);
  });
});

// The playbook is settings.strategyNotes, name -> text, edited inline in
// Settings. These assert the per-strategy field wiring; normalization
// (blank-dropping, length cap) is covered in lib/trade.test.js.
describe("SettingsPanel — Strategy Playbook", () => {
  const settingsProps = (overrides = {}) => ({
    settings: DEFAULT_SETTINGS,
    setSettings: vi.fn(),
    trades: [],
    replaceAllData: vi.fn(),
    theme: "dark",
    setTheme: vi.fn(),
    strategies: ["ICT", "Scalping"],
    setStrategies: vi.fn(),
    onImportTrades: vi.fn(),
    activeAccountId: "",
    setActiveAccountId: vi.fn(),
    preferences: DEFAULT_PREFERENCES,
    setPreferences: vi.fn(),
    ...overrides,
  });

  it("shows one note field per strategy, prefilled from settings", () => {
    render(<SettingsPanel {...settingsProps({ settings: { ...DEFAULT_SETTINGS, strategyNotes: { ICT: "Liquidity sweep entry." } } })} />);
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
    render(<SettingsPanel {...settingsProps({ settings: { ...DEFAULT_SETTINGS, strategyNotes: { ICT: "Old note" } }, setSettings })} />);

    fireEvent.change(screen.getByLabelText("Scalping"), { target: { value: "Quick in and out." } });

    expect(captured.strategyNotes).toEqual({ ICT: "Old note", Scalping: "Quick in and out." });
  });

  it("prompts to add a strategy first when the list is empty", () => {
    render(<SettingsPanel {...settingsProps({ strategies: [] })} />);
    expect(screen.getByText(/no strategies yet — add one with manage/i)).toBeTruthy();
  });
});
