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
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TradeForm, TradesTable } from "./App";
import { computeTrade } from "./lib/trade";

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

  it("hides a switched-off column", () => {
    render(<TradesTable {...tableProps([closedTrade("TJ-00001", "BTCUSDT", "110")], { hiddenColumns: ["grade"] })} />);
    expect(screen.queryByText("Grade")).toBeNull();
  });
});
