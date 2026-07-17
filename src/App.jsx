import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
// flushSync only wraps tab-switch state updates inside document.startViewTransition,
// which needs the DOM updated synchronously inside its callback to snapshot it.
import { flushSync } from "react-dom";
// Recharts is not imported here on purpose — the chart components live in
// ./Charts and are loaded on demand, so the library stays out of this bundle.
// xlsx is large and only needed the moment someone exports a workbook, so it is
// imported on demand inside exportExcel rather than shipped in the main bundle.
import {
  LayoutDashboard, ListChecks, PlusCircle, BarChart3, CalendarDays, FileDown,
  Settings as SettingsIcon, TrendingUp, TrendingDown, X, Upload, Download,
  Trash2, Pencil, Search, Filter, ChevronDown, ChevronUp, Sun, Moon, Image as ImageIcon,
  DollarSign, Percent, Target, Activity, Award,
  AlertTriangle, Save, RotateCcw, Flame, Snowflake, ChevronLeft, ChevronRight,
  FileSpreadsheet, FileText, Database, ShieldCheck, Calculator, Plus, Check, Loader2,
  Copy, ListPlus, ArrowLeft, ArrowRight, PanelLeftClose, PanelLeftOpen, Layers, Wallet, Keyboard, Table2
} from "lucide-react";
import { storage } from "./lib/storage";
import {
  num, round, fmtCurrency, fmtPercent, fmtNum,
  fmtProfitFactor, fmtSignedCurrency, fmtSignedPercent,
} from "./lib/format";
// The journal's rules — trade maths, stats, date bucketing, sharding, CSV,
// account normalization — live in ./lib/trade so they can be tested without
// React or storage in the way. This file is the shell around them.
import {
  MARKET_TYPES, DIRECTIONS, GRADES, STATUS, DEFAULT_STRATEGIES, DEFAULT_GOALS,
  DEFAULT_CHECKLIST_RULES, DEFAULT_SETTINGS, DEFAULT_FILTERS, DEFAULT_PREFERENCES,
  SHARD_COUNT, META_KEY, SHARD_PREFIX, SHOTS_PREFIX, shardKey, shardOf,
  uid, nextTradeId, tradeSeq, pad, fmtDate, fmtDateTime, isoDate, isoWeekKey, monthKey, monthLabel,
  weekOfMonthLabel, weekOfMonthKey, toLocalInputValue, parseLocalInputValue,
  normalizeAccounts, mergeSettings, mergePreferences, clampZoom, stepZoom, startOfWeek, dateRangeForPreset, dateInRange,
  groupPerformance, goalProgress, computeTrade, aggregateLegs, stripComputed,
  escapeHtml, tradesToCSV, parseCSV, rowsToTrades, partitionDuplicateImports, paletteFilter, normalizeAccent,
  summarize, equityCurve, maxDrawdown, consecutiveStreaks, sharpeSortino,
  emptyTrade, emptyLeg, withDerivedFills, tradeToForm, formSignature,
} from "./lib/trade";

/* ============================================================================
   TRADING JOURNAL — design tokens
   Trading-desk terminal aesthetic. Deep charcoal-navy base, mono typography
   for figures (ticker feel), electric-blue as the neutral brand accent so it
   never competes with the strict green/red P&L semantics, muted gold as a
   secondary accent for grading/highlights.
============================================================================ */
const APP_NAME = "Brij Trade Journal";
const APP_TAGLINE = "Performance Desk";
// Injected from package.json by vite.config.js, so a release only bumps one
// place. The fallback keeps this defined under tooling that doesn't apply the
// define (e.g. a bare eslint/vitest run outside the Vite pipeline).
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

const TOKENS_DARK = {
  "--bg-950": "#0A0E14", "--bg-900": "#0F141C", "--bg-800": "#141A24", "--bg-700": "#1B222E",
  "--bg-elevated": "#1B222E", "--border": "#232B39", "--border-soft": "#1B222E",
  "--text-primary": "#E7EBF3", "--text-secondary": "#9AA5B8", "--text-muted": "#616D82",
  "--accent": "#3E8FFF", "--accent-soft": "rgba(62,143,255,0.12)",
  "--accent-2": "#C9A84C", "--accent-2-soft": "rgba(201,168,76,0.14)",
  "--profit": "#22C55E", "--profit-soft": "rgba(34,197,94,0.10)", "--profit-border": "rgba(34,197,94,0.35)",
  "--loss": "#F0455B", "--loss-soft": "rgba(240,69,91,0.10)", "--loss-border": "rgba(240,69,91,0.35)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.35)",
};
const TOKENS_LIGHT = {
  "--bg-950": "#F3F4F7", "--bg-900": "#FAFAFC", "--bg-800": "#FFFFFF", "--bg-700": "#FFFFFF",
  "--bg-elevated": "#FFFFFF", "--border": "#E3E6EC", "--border-soft": "#ECEEF2",
  "--text-primary": "#161A22", "--text-secondary": "#5B6474", "--text-muted": "#8C93A3",
  "--accent": "#2563EB", "--accent-soft": "rgba(37,99,235,0.08)",
  "--accent-2": "#9C7C1F", "--accent-2-soft": "rgba(156,124,31,0.10)",
  "--profit": "#0F9D52", "--profit-soft": "rgba(15,157,82,0.08)", "--profit-border": "rgba(15,157,82,0.30)",
  "--loss": "#D63A50", "--loss-soft": "rgba(214,58,80,0.08)", "--loss-border": "rgba(214,58,80,0.30)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.6) inset, 0 8px 20px rgba(20,25,40,0.06)",
};
const TOKENS_MIDNIGHT = {
  "--bg-950": "#050B1A", "--bg-900": "#071126", "--bg-800": "#0B1733", "--bg-700": "#102049",
  "--bg-elevated": "#0B1733", "--border": "#1A2F5A", "--border-soft": "#11264A",
  "--text-primary": "#EAF2FF", "--text-secondary": "#9FB3D9", "--text-muted": "#62769F",
  "--accent": "#60A5FA", "--accent-soft": "rgba(96,165,250,0.14)",
  "--accent-2": "#A78BFA", "--accent-2-soft": "rgba(167,139,250,0.14)",
  "--profit": "#34D399", "--profit-soft": "rgba(52,211,153,0.10)", "--profit-border": "rgba(52,211,153,0.35)",
  "--loss": "#FB7185", "--loss-soft": "rgba(251,113,133,0.10)", "--loss-border": "rgba(251,113,133,0.35)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.04) inset, 0 10px 28px rgba(0,8,30,0.42)",
};
const TOKENS_TRADING_GREEN = {
  "--bg-950": "#06120D", "--bg-900": "#0A1A12", "--bg-800": "#0F2318", "--bg-700": "#153221",
  "--bg-elevated": "#0F2318", "--border": "#214832", "--border-soft": "#183724",
  "--text-primary": "#E8F7EE", "--text-secondary": "#9BC4AA", "--text-muted": "#638370",
  "--accent": "#22C55E", "--accent-soft": "rgba(34,197,94,0.14)",
  "--accent-2": "#D9B44A", "--accent-2-soft": "rgba(217,180,74,0.13)",
  "--profit": "#4ADE80", "--profit-soft": "rgba(74,222,128,0.11)", "--profit-border": "rgba(74,222,128,0.36)",
  "--loss": "#F87171", "--loss-soft": "rgba(248,113,113,0.10)", "--loss-border": "rgba(248,113,113,0.34)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.04) inset, 0 10px 24px rgba(0,35,18,0.36)",
};
const TOKENS_AMOLED = {
  "--bg-950": "#000000", "--bg-900": "#030303", "--bg-800": "#080808", "--bg-700": "#101010",
  "--bg-elevated": "#080808", "--border": "#1F1F1F", "--border-soft": "#141414",
  "--text-primary": "#F2F2F2", "--text-secondary": "#A6A6A6", "--text-muted": "#646464",
  "--accent": "#00E5FF", "--accent-soft": "rgba(0,229,255,0.12)",
  "--accent-2": "#FACC15", "--accent-2-soft": "rgba(250,204,21,0.12)",
  "--profit": "#00FF85", "--profit-soft": "rgba(0,255,133,0.10)", "--profit-border": "rgba(0,255,133,0.32)",
  "--loss": "#FF3B5C", "--loss-soft": "rgba(255,59,92,0.10)", "--loss-border": "rgba(255,59,92,0.32)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.03) inset",
};
const TOKENS_CARBON = {
  "--bg-950": "#08090A", "--bg-900": "#0D0F12", "--bg-800": "#15181C", "--bg-700": "#1D2228",
  "--bg-elevated": "#15181C", "--border": "#2B3138", "--border-soft": "#20252B",
  "--text-primary": "#ECEFF3", "--text-secondary": "#A1AAB5", "--text-muted": "#69727D",
  "--accent": "#7DD3FC", "--accent-soft": "rgba(125,211,252,0.12)",
  "--accent-2": "#C7A65A", "--accent-2-soft": "rgba(199,166,90,0.13)",
  "--profit": "#35D07F", "--profit-soft": "rgba(53,208,127,0.10)", "--profit-border": "rgba(53,208,127,0.32)",
  "--loss": "#FF5A6E", "--loss-soft": "rgba(255,90,110,0.10)", "--loss-border": "rgba(255,90,110,0.32)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.03) inset, 0 10px 26px rgba(0,0,0,0.38)",
};
const TOKENS_GRAPHITE = {
  "--bg-950": "#111315", "--bg-900": "#181B1F", "--bg-800": "#20242A", "--bg-700": "#2A3037",
  "--bg-elevated": "#20242A", "--border": "#343B44", "--border-soft": "#2A3037",
  "--text-primary": "#F0F2F4", "--text-secondary": "#B4BCC6", "--text-muted": "#7B8490",
  "--accent": "#94A3B8", "--accent-soft": "rgba(148,163,184,0.15)",
  "--accent-2": "#EAB308", "--accent-2-soft": "rgba(234,179,8,0.12)",
  "--profit": "#22C55E", "--profit-soft": "rgba(34,197,94,0.10)", "--profit-border": "rgba(34,197,94,0.32)",
  "--loss": "#EF4444", "--loss-soft": "rgba(239,68,68,0.10)", "--loss-border": "rgba(239,68,68,0.32)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 22px rgba(0,0,0,0.25)",
};
const TOKENS_CYBER_BLUE = {
  "--bg-950": "#03111E", "--bg-900": "#061A2D", "--bg-800": "#08233D", "--bg-700": "#0B3154",
  "--bg-elevated": "#08233D", "--border": "#164B78", "--border-soft": "#0F3A62",
  "--text-primary": "#E5F7FF", "--text-secondary": "#99C9E6", "--text-muted": "#5E88A3",
  "--accent": "#00D5FF", "--accent-soft": "rgba(0,213,255,0.14)",
  "--accent-2": "#38BDF8", "--accent-2-soft": "rgba(56,189,248,0.13)",
  "--profit": "#00FFB3", "--profit-soft": "rgba(0,255,179,0.10)", "--profit-border": "rgba(0,255,179,0.34)",
  "--loss": "#FF4D7D", "--loss-soft": "rgba(255,77,125,0.10)", "--loss-border": "rgba(255,77,125,0.34)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 30px rgba(0,42,75,0.4)",
};
const TOKENS_DARK_PURPLE = {
  "--bg-950": "#100917", "--bg-900": "#170D22", "--bg-800": "#211330", "--bg-700": "#2E1A43",
  "--bg-elevated": "#211330", "--border": "#41275C", "--border-soft": "#331F49",
  "--text-primary": "#F3EAFE", "--text-secondary": "#C5AEDC", "--text-muted": "#83699C",
  "--accent": "#A855F7", "--accent-soft": "rgba(168,85,247,0.14)",
  "--accent-2": "#F0ABFC", "--accent-2-soft": "rgba(240,171,252,0.12)",
  "--profit": "#34D399", "--profit-soft": "rgba(52,211,153,0.10)", "--profit-border": "rgba(52,211,153,0.32)",
  "--loss": "#FB7185", "--loss-soft": "rgba(251,113,133,0.10)", "--loss-border": "rgba(251,113,133,0.32)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 30px rgba(20,0,40,0.38)",
};
const TOKENS_NORD = {
  "--bg-950": "#242933", "--bg-900": "#2E3440", "--bg-800": "#3B4252", "--bg-700": "#434C5E",
  "--bg-elevated": "#3B4252", "--border": "#4C566A", "--border-soft": "#434C5E",
  "--text-primary": "#ECEFF4", "--text-secondary": "#D8DEE9", "--text-muted": "#9AA8BA",
  "--accent": "#88C0D0", "--accent-soft": "rgba(136,192,208,0.14)",
  "--accent-2": "#EBCB8B", "--accent-2-soft": "rgba(235,203,139,0.12)",
  "--profit": "#A3BE8C", "--profit-soft": "rgba(163,190,140,0.12)", "--profit-border": "rgba(163,190,140,0.34)",
  "--loss": "#BF616A", "--loss-soft": "rgba(191,97,106,0.12)", "--loss-border": "rgba(191,97,106,0.34)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 22px rgba(0,0,0,0.24)",
};
const TOKENS_DRACULA = {
  "--bg-950": "#1E1F29", "--bg-900": "#282A36", "--bg-800": "#303241", "--bg-700": "#3B3E50",
  "--bg-elevated": "#303241", "--border": "#44475A", "--border-soft": "#393C4E",
  "--text-primary": "#F8F8F2", "--text-secondary": "#CFCFE8", "--text-muted": "#8D8EA8",
  "--accent": "#BD93F9", "--accent-soft": "rgba(189,147,249,0.14)",
  "--accent-2": "#F1FA8C", "--accent-2-soft": "rgba(241,250,140,0.12)",
  "--profit": "#50FA7B", "--profit-soft": "rgba(80,250,123,0.10)", "--profit-border": "rgba(80,250,123,0.32)",
  "--loss": "#FF5555", "--loss-soft": "rgba(255,85,85,0.10)", "--loss-border": "rgba(255,85,85,0.32)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.04) inset, 0 10px 26px rgba(0,0,0,0.28)",
};
const TOKENS_MATERIAL_DARK = {
  "--bg-950": "#0F1115", "--bg-900": "#121212", "--bg-800": "#1E1E1E", "--bg-700": "#2A2A2A",
  "--bg-elevated": "#1E1E1E", "--border": "#333333", "--border-soft": "#292929",
  "--text-primary": "#E8EAED", "--text-secondary": "#BDC1C6", "--text-muted": "#80868B",
  "--accent": "#8AB4F8", "--accent-soft": "rgba(138,180,248,0.14)",
  "--accent-2": "#FDD663", "--accent-2-soft": "rgba(253,214,99,0.12)",
  "--profit": "#81C995", "--profit-soft": "rgba(129,201,149,0.11)", "--profit-border": "rgba(129,201,149,0.33)",
  "--loss": "#F28B82", "--loss-soft": "rgba(242,139,130,0.11)", "--loss-border": "rgba(242,139,130,0.33)",
  "--card-shadow": "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 22px rgba(0,0,0,0.30)",
};
const THEMES = {
  dark: { label: "Dark", icon: Moon, tokens: TOKENS_DARK },
  light: { label: "Light", icon: Sun, tokens: TOKENS_LIGHT },
  amoled: { label: "AMOLED Black", icon: Moon, tokens: TOKENS_AMOLED },
  carbon: { label: "Carbon Black", icon: Moon, tokens: TOKENS_CARBON },
  graphite: { label: "Graphite", icon: Moon, tokens: TOKENS_GRAPHITE },
  midnight: { label: "Midnight Blue", icon: Moon, tokens: TOKENS_MIDNIGHT },
  green: { label: "Trading Green", icon: TrendingUp, tokens: TOKENS_TRADING_GREEN },
  cyber: { label: "Cyber Blue", icon: Activity, tokens: TOKENS_CYBER_BLUE },
  purple: { label: "Dark Purple", icon: Moon, tokens: TOKENS_DARK_PURPLE },
  nord: { label: "Nord Dark", icon: Snowflake, tokens: TOKENS_NORD },
  dracula: { label: "Dracula", icon: Moon, tokens: TOKENS_DRACULA },
  material: { label: "Material Dark", icon: Moon, tokens: TOKENS_MATERIAL_DARK },
};
// Font faces are bundled locally and imported in main.jsx (see @fontsource
// imports there). No remote @import — the packaged app must render its type
// offline. The family names below ('Inter', 'Space Grotesk', 'JetBrains Mono')
// resolve to those self-hosted @font-face declarations.

/* ============================================================================
   STATIC STYLESHEET
   Everything here is theme-independent: colours come through as var(--token)
   and the tokens themselves are injected separately per theme. Kept at module
   scope so this multi-thousand-character string is built once at import, not
   re-concatenated on every App render.
============================================================================ */
const APP_CSS = `
* { box-sizing: border-box; }
.app-root { font-family: 'Inter', system-ui, sans-serif; background: var(--bg-950); color: var(--text-primary); min-height: 100vh; display: flex; width: 100%; }
.mono { font-family: 'JetBrains Mono', monospace; }
.spin { animation: spin 0.9s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }

.sidebar { width: 218px; flex-shrink: 0; background: var(--bg-900); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 18px 12px; gap: 4px; transition: width 0.16s ease, padding 0.16s ease; }
/* Collapsed rail: icons only. Desktop-only on purpose — under 860px the sidebar
   is an off-canvas drawer that is already hidden by default, so collapsing it
   there would just make a 62px drawer. Labels use display:none rather than
   opacity so they leave the flow entirely and can't force the rail wider. */
@media (min-width: 861px) {
  .sidebar-collapsed { width: 62px; padding: 18px 8px; }
  .sidebar-collapsed .brand { justify-content: center; padding: 6px 0 18px; }
  .sidebar-collapsed .brand-labels, .sidebar-collapsed .nav-label, .sidebar-collapsed .sidebar-footer { display: none; }
  .sidebar-collapsed .nav-item { justify-content: center; gap: 0; padding: 9px 0; position: relative; }
  /* The open-trade count has no room beside a hidden label, so it rides the icon
     as a corner bubble instead of dropping off the rail entirely. */
  .sidebar-collapsed .nav-badge { position: absolute; top: 1px; right: 4px; }
  .sidebar-collapsed .nav-badge .badge { padding: 0 4px; font-size: 9px; line-height: 1.5; }
}
.brand { display: flex; align-items: center; gap: 9px; padding: 6px 8px 18px; }
.profile-mark { position: relative; border-radius: 8px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); display: flex; align-items: center; justify-content: center; font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: #06090F; flex-shrink: 0; cursor: pointer; overflow: hidden; }
.profile-mark img { width: 100%; height: 100%; object-fit: cover; display: block; }
.profile-mark-overlay { position: absolute; inset: 0; background: rgba(6,9,15,0.55); display: flex; align-items: center; justify-content: center; color: #fff; }
.profile-mark-remove { position: absolute; top: -4px; right: -4px; width: 15px; height: 15px; border-radius: 50%; background: var(--loss); color: #fff; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; box-shadow: 0 0 0 2px var(--bg-900); }
.brand-text { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 13.5px; letter-spacing: 0.2px; line-height: 1.25; }
.brand-sub { font-size: 10px; color: var(--text-muted); letter-spacing: 0.5px; text-transform: uppercase; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; border: none; background: transparent; color: var(--text-secondary); font-size: 13.5px; font-weight: 500; cursor: pointer; text-align: left; font-family: 'Inter', sans-serif; width: 100%; transition: background 0.12s, color 0.12s; }
.nav-item:hover { background: var(--bg-800); color: var(--text-primary); }
.nav-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.nav-label { flex: 1; }
.sidebar-footer { margin-top: auto; padding: 10px 8px; font-size: 10.5px; color: var(--text-muted); }

.main-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 24px; border-bottom: 1px solid var(--border); background: var(--bg-900); }
.topbar-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.nav-arrows { display: flex; align-items: center; gap: 4px; }
/* A disabled arrow stays visible rather than hiding, so the control row doesn't
   reflow as history builds up behind you. */
.icon-btn:disabled { opacity: 0.4; cursor: default; }
.icon-btn:disabled:hover { background: var(--bg-800); color: var(--text-secondary); }
.topbar h2 { font-family: 'Space Grotesk', sans-serif; font-size: 18px; margin: 0; }
.topbar-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

.ticker-strip { overflow: hidden; background: var(--bg-950); border-bottom: 1px solid var(--border); white-space: nowrap; }
.ticker-track { display: inline-flex; animation: ticker-scroll 32s linear infinite; padding: 7px 0; }
.ticker-strip:hover .ticker-track { animation-play-state: paused; }
@keyframes ticker-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
.ticker-item { display: inline-flex; align-items: baseline; gap: 6px; padding: 0 22px; border-right: 1px solid var(--border-soft); }
.ticker-clone { display: inline-flex; }
.ticker-key { font-size: 10px; letter-spacing: 0.6px; color: var(--text-muted); }
.ticker-val { font-size: 12.5px; font-weight: 600; }

.content-scroll { flex: 1; overflow-y: auto; padding: 20px 24px 40px; }
/* Cap on ultrawide monitors: stat cards and tables stretched across 3440px are
   unreadable. The cap lives on an inner wrapper because the scroll container
   itself has to span the column for the scrollbar to sit at the window edge. */
.content-inner { max-width: 1680px; margin: 0 auto; }

.btn { display: inline-flex; align-items: center; gap: 6px; font-family: 'Inter', sans-serif; font-size: 12.5px; font-weight: 600; border-radius: 8px; padding: 8px 13px; border: 1px solid transparent; cursor: pointer; transition: all 0.12s; }
.btn-primary { background: var(--accent); color: #061019; }
.btn-primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
.btn-ghost { background: var(--bg-800); color: var(--text-primary); border-color: var(--border); }
.btn-ghost:hover { background: var(--bg-700); }
.btn-danger-ghost { background: var(--loss-soft); color: var(--loss); border-color: var(--loss-border); }
.btn-danger-ghost:hover { filter: brightness(1.1); }
.btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none !important; }

.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-800); color: var(--text-secondary); cursor: pointer; }
.icon-btn:hover { color: var(--text-primary); background: var(--bg-700); }
.icon-btn-danger:hover { color: var(--loss); border-color: var(--loss-border); }

.cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.stat-card { background: var(--bg-800); border: 1px solid var(--border); border-radius: 12px; padding: 14px 15px; box-shadow: var(--card-shadow); transition: transform 0.15s, border-color 0.15s; }
.stat-card:hover { transform: translateY(-2px); border-color: var(--accent); }
.stat-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.stat-label { font-size: 10.5px; letter-spacing: 0.4px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
.stat-help { display: inline-flex; align-items: center; justify-content: center; width: 12px; height: 12px; margin-left: 5px; border-radius: 50%; border: 1px solid var(--border); color: var(--text-muted); font-size: 8px; font-weight: 700; cursor: help; vertical-align: middle; }
.stat-help:hover, .stat-help:focus { color: var(--accent); border-color: var(--accent); outline: none; }
.stat-value { font-size: 20px; font-weight: 700; }
.stat-sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; }

.stack { display: flex; flex-direction: column; gap: 16px; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 980px) { .two-col { grid-template-columns: 1fr; } }

.panel { background: var(--bg-800); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.panel-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border-soft); }
.panel-header h4 { font-family: 'Space Grotesk', sans-serif; font-size: 13.5px; margin: 0; font-weight: 600; }
.panel-body { padding: 14px 16px 18px; }

.badge { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700; padding: 3px 8px; border-radius: 20px; letter-spacing: 0.3px; }
.badge-neutral { background: var(--bg-700); color: var(--text-secondary); border: 1px solid var(--border); }
.badge-profit { background: var(--profit-soft); color: var(--profit); border: 1px solid var(--profit-border); }
.badge-loss { background: var(--loss-soft); color: var(--loss); border: 1px solid var(--loss-border); }
.badge-accent { background: var(--accent-soft); color: var(--accent); border: 1px solid rgba(62,143,255,0.35); }
.badge-gold { background: var(--accent-2-soft); color: var(--accent-2); border: 1px solid rgba(201,168,76,0.35); }

.table-wrap { overflow-x: auto; }
.trades-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.trades-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted); padding: 8px 10px; border-bottom: 1px solid var(--border); cursor: pointer; white-space: nowrap; user-select: none; }
.trades-table td { padding: 9px 10px; border-bottom: 1px solid var(--border-soft); white-space: nowrap; }
.trades-table tbody tr { cursor: pointer; transition: background 0.1s; }
.trades-table tbody tr:hover { background: var(--bg-700); }
.row-win { background: var(--profit-soft); }
.row-loss { background: var(--loss-soft); }
/* Bulk selection bar above the table. Sticky so the actions stay reachable
   while scrolling a long selection. */
/* Accent border matches .row-selected's outline, so the bar reads as part of
   the same selection state rather than as another filter panel. */
.bulk-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; position: sticky; top: 0; z-index: 20; background: var(--bg-elevated); border: 1px solid var(--accent); border-radius: 10px; padding: 9px 12px; margin-bottom: 10px; }
.bulk-count { font-size: 12.5px; color: var(--text-primary); font-weight: 600; }
.bulk-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row-selected { outline: 1px solid var(--accent); outline-offset: -1px; }
/* Keyboard cursor over the trades table (j/k or arrows). Heavier than
   .row-selected's 1px so the two states read apart when they coincide. */
.row-cursor { outline: 2px solid var(--accent); outline-offset: -2px; }
/* Right-aligned strip above the table holding the column picker. */
.table-toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; position: relative; }
.column-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 60; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.4); padding: 8px; min-width: 180px; }
.column-menu-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
.column-menu-item:hover { background: var(--bg-700); color: var(--text-primary); }
.column-menu-item input { cursor: pointer; }
.column-menu-item.column-locked { opacity: 0.5; cursor: default; }
.column-menu-item.column-locked:hover { background: transparent; color: var(--text-secondary); }
.cell-strong { font-weight: 600; }
/* Small inline marks on a table cell — a fills icon, a partial-close tag. */
.cell-mark { display: inline-flex; align-items: center; gap: 2px; margin-left: 5px; color: var(--text-muted); font-size: 8.5px; font-weight: 700; letter-spacing: 0.3px; vertical-align: middle; }
.cell-mark-accent { color: var(--accent); }
.muted { color: var(--text-muted); }
.row-actions { display: flex; gap: 6px; align-items: center; }
/* Sortable columns look inert until hovered, so the chevron is always
   present on them — just faint until the column is the active sort. */
.th-sortable { cursor: pointer; }
.th-sort-hint { opacity: 0; transition: opacity 0.12s; }
.th-sortable:hover .th-sort-hint { opacity: 0.45; }
.row-edit-btn { padding: 4px 9px; font-size: 11px; }
.compact-table td, .compact-table th { padding: 7px 9px; }
.pager { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 14px 0 2px; }

.empty-state, .empty-state-sm { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 40px 10px; color: var(--text-muted); text-align: center; font-size: 13px; }
.empty-state-sm { padding: 30px 10px; font-size: 12px; }
/* The whole-panel variant: a journal (or tab) with nothing in it yet gets a
   title and a way forward, not just a shrug. */
.empty-state-lg { padding: 72px 16px; gap: 10px; }
.empty-state-lg h4 { font-family: 'Space Grotesk', sans-serif; font-size: 15px; margin: 0; color: var(--text-primary); }
.empty-state-lg p { margin: 0; max-width: 380px; line-height: 1.55; }
.empty-state-lg .btn { margin-top: 6px; }
/* Holds the chart's height while the chart chunk loads, so panels don't collapse
   and then jump once Recharts arrives. */
.chart-loading { width: 100%; border-radius: 8px; background: linear-gradient(90deg, var(--bg-900) 25%, var(--bg-800) 50%, var(--bg-900) 75%); background-size: 200% 100%; animation: chart-shimmer 1.2s ease-in-out infinite; }
@keyframes chart-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

.filters-bar { background: var(--bg-800); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
.filters-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.search-box { flex: 1; min-width: 220px; display: flex; align-items: center; gap: 8px; background: var(--bg-900); border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; color: var(--text-muted); }
.search-box input { border: none; background: transparent; outline: none; color: var(--text-primary); font-size: 12.5px; width: 100%; }
.filter-count { background: var(--accent); color: #061019; border-radius: 10px; font-size: 10px; padding: 1px 6px; margin-left: 3px; }
.filters-expanded { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-soft); }

.field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; position: relative; }
.field-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted); font-weight: 600; }
.field-span { grid-column: 1 / -1; }
.input { background: var(--bg-900); border: 1px solid var(--border); color: var(--text-primary); border-radius: 7px; padding: 8px 10px; font-size: 12.5px; font-family: 'Inter', sans-serif; outline: none; width: 100%; }
.input:focus { border-color: var(--accent); }
/* A field the app owns rather than the user: derived from something they typed
   elsewhere, so it reads as an input but never invites one. */
.input:disabled, .input-readonly { background: var(--bg-800); color: var(--text-secondary); cursor: default; }
.textarea { resize: vertical; font-family: 'Inter', sans-serif; }

.segmented { display: flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; }
.seg-btn { flex: 1; padding: 8px 10px; background: var(--bg-900); border: none; color: var(--text-secondary); font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; }
.seg-btn + .seg-btn { border-left: 1px solid var(--border); }
.seg-active-long { background: var(--profit-soft); color: var(--profit); }
.seg-active-short { background: var(--loss-soft); color: var(--loss); }
.seg-active-plain { background: var(--accent-soft); color: var(--accent); }
.segmented-tight { width: auto; max-width: 520px; }
.segmented-tight .seg-btn { white-space: nowrap; padding: 7px 9px; }

.form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px 16px; }
@media (max-width: 720px) { .form-grid { grid-template-columns: 1fr; } }
.form-error { display: flex; align-items: center; gap: 6px; color: var(--loss); font-size: 12px; margin-top: 12px; }
.form-note { font-size: 12px; color: var(--accent); margin-top: 10px; }
.drawdown-banner { display: flex; align-items: center; gap: 8px; background: var(--loss-soft); color: var(--loss); border: 1px solid var(--loss-border); border-radius: 10px; padding: 10px 14px; font-size: 12.5px; font-weight: 600; }
.daynote-btn { position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; border-radius: 4px; border: none; background: transparent; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.daynote-btn:hover { color: var(--accent); }
.daynote-dot { position: absolute; bottom: 3px; right: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--accent-2); }

/* Fill legs. Each row is price / quantity / time plus a remove button; the row
   collapses to a stack on narrow screens, where four columns cannot fit. */
.leg-list { display: flex; flex-direction: column; gap: 8px; }
.leg-row { display: grid; grid-template-columns: 18px 1fr 1fr 1.4fr auto; align-items: end; gap: 8px; }
.leg-index { color: var(--text-muted); font-size: 11px; padding-bottom: 9px; }
.leg-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.leg-remove { align-self: end; }
.leg-foot { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
@media (max-width: 720px) {
  .leg-row { grid-template-columns: 1fr auto; }
  .leg-index { display: none; }
  .leg-field-time { grid-column: 1 / -1; }
}

/* One card per account in Settings. Each is an editable record, not a row. */
.account-list { display: flex; flex-direction: column; gap: 10px; }
.account-card { background: var(--bg-900); border: 1px solid var(--border-soft); border-radius: 10px; padding: 12px; }
.account-card-grid { display: grid; grid-template-columns: 1.2fr 1fr 0.8fr; gap: 12px; }
.account-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-soft); }
.account-scope { display: flex; align-items: center; gap: 8px; }
@media (max-width: 720px) { .account-card-grid { grid-template-columns: 1fr; } }

.calc-summary { background: var(--bg-900); border: 1px solid var(--border-soft); border-radius: 10px; padding: 12px; }
.calc-summary-readout { background: var(--accent-soft); border-color: rgba(62,143,255,0.25); }
.calc-row { display: flex; align-items: flex-end; gap: 12px; }
.calc-input-group { flex: 1; display: flex; flex-direction: column; gap: 5px; }
.calc-icon { color: var(--accent); margin-bottom: 8px; flex-shrink: 0; }
.calc-facts { display: flex; gap: 18px; margin-top: 10px; font-size: 11.5px; color: var(--text-secondary); }
.readout-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.readout-val { font-size: 15px; font-weight: 700; margin-top: 2px; }
@media (max-width: 720px) { .readout-grid { grid-template-columns: 1fr; } }

.strategy-row { display: flex; gap: 8px; }
.strategy-row .input { flex: 1; }
.strategy-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.tag-input-row { display: flex; gap: 8px; }
.tag-input-row .input { flex: 1; }
.tag-chip { display: inline-flex; align-items: center; gap: 5px; }
.tag-chip button { display: inline-flex; background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 0; }
.tag-chip button:hover { color: var(--loss); }
.checklist-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }
.checklist-done { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--profit); }
.strategy-mgr-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; margin-bottom: 12px; }
.strategy-mgr-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--bg-900); border: 1px solid var(--border-soft); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; }
.strategy-mgr-actions { display: flex; gap: 6px; flex-shrink: 0; }
.strategy-add-row { display: flex; gap: 8px; }
.strategy-add-row .input { flex: 1; }
.about-row { display: flex; align-items: center; gap: 12px; }
.about-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15px; }

.shot-upload-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.hint { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
.shot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; margin-top: 10px; }
.shot-thumb { position: relative; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--bg-900); }
.shot-thumb img { width: 100%; height: 90px; object-fit: cover; display: block; }
.shot-thumb-lg img { height: 130px; }
.shot-thumb-meta { display: flex; align-items: center; justify-content: space-between; padding: 5px 7px; font-size: 10px; color: var(--text-secondary); background: var(--bg-800); }
.shot-thumb-meta button { background: none; border: none; color: var(--text-muted); cursor: pointer; display: flex; }
.shot-thumb-meta button:hover { color: var(--accent); }

.modal-overlay { position: fixed; inset: 0; background: rgba(4,7,12,0.65); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
.modal-panel { background: var(--bg-800); border: 1px solid var(--border); border-radius: 14px; width: 100%; max-width: 560px; max-height: 88vh; display: flex; flex-direction: column; animation: modalIn 0.16s ease; }
@keyframes modalIn { from { opacity: 0; transform: translateY(6px) scale(0.98); } to { opacity: 1; transform: none; } }
.modal-wide { max-width: 780px; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--border-soft); }
.modal-header h3 { font-family: 'Space Grotesk', sans-serif; font-size: 15px; margin: 0; }
.modal-body { padding: 18px; overflow-y: auto; }
.modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 18px; border-top: 1px solid var(--border-soft); }
.modal-panel:focus { outline: none; }
.confirm-msg { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-secondary); }

.detail-top { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 620px) { .detail-grid { grid-template-columns: repeat(2, 1fr); } }
.detail-stat { display: flex; flex-direction: column; gap: 4px; background: var(--bg-900); border: 1px solid var(--border-soft); border-radius: 8px; padding: 9px 11px; }
.detail-stat-val { font-size: 13px; font-weight: 600; }
.detail-notes { margin-top: 16px; background: var(--bg-900); border: 1px solid var(--border-soft); border-radius: 8px; padding: 12px; }
.detail-notes p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-secondary); }
.detail-shots { margin-top: 16px; }

.dt-picker { position: relative; }
.dt-trigger { display: flex; align-items: center; gap: 7px; cursor: pointer; text-align: left; color: var(--text-primary); }
.dt-trigger-empty { color: var(--text-muted); }
.dt-popover { position: absolute; top: calc(100% + 6px); left: 0; z-index: 50; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 12px; padding: 12px; width: 260px; box-shadow: 0 12px 32px rgba(0,0,0,0.4); animation: modalIn 0.14s ease; }
.dt-cal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 12px; font-weight: 600; }
.dt-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; text-align: center; }
.dt-cal-dow { margin-bottom: 3px; font-size: 10px; color: var(--text-muted); }
.dt-day { aspect-ratio: 1; border: none; background: transparent; color: var(--text-primary); border-radius: 6px; font-size: 11.5px; cursor: pointer; }
.dt-day:hover { background: var(--bg-700); }
.dt-day-sel { background: var(--accent); color: #061019; font-weight: 700; }
.dt-day-today { border: 1px solid var(--accent); }
.dt-time-row { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
.dt-time-row .input { padding: 6px 8px; }
.dt-now-btn { margin-left: auto; padding: 6px 9px; font-size: 11px; }
.dt-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }

.calendar-card { background: var(--bg-800); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.calendar-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.calendar-header h4 { font-family: 'Space Grotesk', sans-serif; font-size: 14px; margin: 0; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
.calendar-dow { margin-bottom: 4px; }
.calendar-dow-cell { font-size: 10px; text-align: center; color: var(--text-muted); font-weight: 600; }
.calendar-cell { position: relative; aspect-ratio: 1; border: 1px solid var(--border-soft); border-radius: 8px; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; cursor: pointer; padding: 4px; }
.calendar-cell-empty { border: none; cursor: default; }
.calendar-daynum { font-size: 10.5px; color: var(--text-muted); align-self: flex-start; }
.calendar-pnl { font-size: 10.5px; font-weight: 700; }
.calendar-count { font-size: 8.5px; color: var(--text-muted); }
.calendar-grid-months { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 620px) { .calendar-grid-months { grid-template-columns: repeat(2, 1fr); } }
.calendar-cell-month { aspect-ratio: 16 / 9; cursor: default; }
.day-focus { border: 1px solid var(--border-soft); border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.day-focus-head { display: flex; align-items: center; justify-content: space-between; width: 100%; margin-bottom: 4px; }
.day-focus-pnl { font-size: 30px; font-weight: 700; }
.day-focus-sub { font-size: 12px; color: var(--text-muted); }
.day-focus-note { margin: 12px 0 0; font-size: 12.5px; line-height: 1.6; color: var(--text-secondary); white-space: pre-wrap; }

.mini-compare { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 720px) { .mini-compare { grid-template-columns: 1fr; } }
.mini-block { background: var(--bg-900); border: 1px solid var(--border-soft); border-radius: 10px; padding: 12px 14px; border-top: 3px solid var(--accent); }
.mini-block-profit { border-top-color: var(--profit); }
.mini-block-gold { border-top-color: var(--accent-2); }
.mini-block-accent { border-top-color: var(--accent); }
.mini-block h5 { margin: 0 0 8px; font-family: 'Space Grotesk', sans-serif; font-size: 13px; }
.mini-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text-secondary); padding: 4px 0; }

.pair-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; max-height: 460px; overflow-y: auto; padding-right: 2px; }
.pair-card { background: var(--bg-900); border: 1px solid var(--border-soft); border-top: 3px solid var(--accent); border-radius: 10px; padding: 10px 12px; min-width: 0; }
.pair-card-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 6px; }
.pair-card-symbol { font-size: 12.5px; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.reports-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 720px) { .reports-grid { grid-template-columns: 1fr; } }
.report-card { background: var(--bg-900); border: 1px solid var(--border-soft); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.report-card h5 { margin: 0; font-family: 'Space Grotesk', sans-serif; font-size: 14px; }
.report-card p { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.checkbox-row { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-secondary); }

.settings-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.theme-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
.theme-tile { display: flex; align-items: center; justify-content: center; gap: 7px; background: var(--bg-900); border: 1px solid var(--border); color: var(--text-secondary); border-radius: 8px; padding: 9px 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
.theme-tile:hover, .theme-tile-active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
/* Accent colour override picker (Settings > Appearance). */
.accent-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.accent-swatch { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; flex-shrink: 0; }
.accent-swatch:hover { transform: scale(1.12); }
.accent-swatch-active { border-color: var(--text-primary); box-shadow: 0 0 0 2px var(--bg-800); }
.accent-swatch-default { background: var(--bg-700); color: var(--text-secondary); width: auto; border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 600; border: 1px solid var(--border); }
.accent-custom { width: 24px; height: 24px; padding: 0; border: 1px solid var(--border); border-radius: 50%; background: transparent; cursor: pointer; }
.goal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.goal-row { background: var(--bg-900); border: 1px solid var(--border-soft); border-radius: 10px; padding: 12px; }
.goal-row-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--text-secondary); margin-bottom: 9px; }
.progress-track { height: 8px; background: var(--bg-700); border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--profit)); border-radius: inherit; transition: width 0.25s ease; }
.goal-percent { margin-top: 7px; font-size: 11px; color: var(--text-muted); }

.mobile-topnav { display: none; }
@media (max-width: 860px) {
  .sidebar { position: fixed; left: -240px; top: 0; bottom: 0; z-index: 90; transition: left 0.2s; box-shadow: 10px 0 30px rgba(0,0,0,0.3); }
  .sidebar.open { left: 0; }
  .mobile-topnav { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--bg-900); }
  .cards-grid { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .content-scroll { padding: 16px; }
  .topbar { padding: 12px 16px; }
}

.lightbox-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.92); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 16px; }
.lightbox-panel { display: flex; flex-direction: column; background: var(--bg-800); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; animation: modalIn 0.16s ease; max-width: 92vw; }
.lightbox-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border-soft); flex-shrink: 0; }
.lightbox-img-wrap { overflow: auto; display: flex; align-items: center; justify-content: center; padding: 12px; }
.lightbox-img-wrap img { max-width: 85vw; max-height: 78vh; object-fit: contain; border-radius: 4px; }
.lightbox-nav { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-top: 1px solid var(--border-soft); }
.live-clock { font-size: 11.5px; color: var(--text-muted); }
/* Account scope picker in the topbar. Sized to its own content rather than the
   longest account name, so a verbose name can't push New Trade off the bar. */
.account-switcher { display: flex; align-items: center; gap: 6px; color: var(--text-muted); flex-shrink: 0; }
.account-select { width: auto; max-width: 190px; padding: 6px 8px; font-size: 12px; }
@media (max-width: 900px) { .account-switcher { display: none; } }
.autocomplete-wrap { position: relative; }
.autocomplete-menu { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); z-index: 60; overflow: hidden; }
.autocomplete-item { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 8px 12px; background: transparent; border: none; color: var(--text-primary); font-size: 12.5px; cursor: pointer; text-align: left; gap: 12px; }
.autocomplete-item:hover, .autocomplete-item-active { background: var(--bg-700); }
.autocomplete-item span:last-child { font-size: 11px; color: var(--text-muted); flex-shrink: 0; }

.toast-host { position: fixed; bottom: 20px; right: 20px; z-index: 300; display: flex; flex-direction: column; gap: 10px; max-width: min(380px, calc(100vw - 40px)); }
.toast { display: flex; align-items: center; gap: 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 10px; padding: 11px 13px; box-shadow: 0 12px 30px rgba(0,0,0,0.4); animation: toastIn 0.18s ease; }
.toast-profit { border-left-color: var(--profit); }
.toast-loss, .toast-danger { border-left-color: var(--loss); }
.toast-accent { border-left-color: var(--accent); }
.toast-msg { flex: 1; font-size: 12.5px; color: var(--text-primary); line-height: 1.4; }
.toast-action { background: transparent; border: 1px solid var(--accent); color: var(--accent); border-radius: 7px; padding: 5px 11px; font-size: 12px; font-weight: 700; cursor: pointer; flex-shrink: 0; font-family: 'Inter', sans-serif; }
.toast-action:hover { background: var(--accent-soft); }
.toast-close { background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: flex; flex-shrink: 0; padding: 2px; }
.toast-close:hover { color: var(--text-primary); }
@keyframes toastIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@media (max-width: 860px) { .toast-host { bottom: 12px; right: 12px; left: 12px; max-width: none; } }

/* Command palette (Ctrl/Cmd+K). Top-anchored rather than centered so the list
   growing and shrinking under the query doesn't bounce the input around.
   z-index sits above the detail/trade modals (100) — the palette can be opened
   over them — and below the toasts (300). */
.palette-overlay { position: fixed; inset: 0; background: rgba(4,7,12,0.65); backdrop-filter: blur(2px); z-index: 250; display: flex; justify-content: center; align-items: flex-start; padding: 12vh 16px 16px; }
.palette-panel { width: 100%; max-width: 580px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,0.5); overflow: hidden; animation: modalIn 0.14s ease; display: flex; flex-direction: column; }
.palette-input-row { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border-soft); color: var(--text-muted); }
.palette-input { flex: 1; background: transparent; border: none; outline: none; color: var(--text-primary); font-family: 'Inter', sans-serif; font-size: 13.5px; min-width: 0; }
.palette-input::placeholder { color: var(--text-muted); }
.palette-list { max-height: 350px; overflow-y: auto; padding: 6px; }
.palette-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border: none; border-radius: 8px; background: transparent; color: var(--text-secondary); font-family: 'Inter', sans-serif; font-size: 13px; cursor: pointer; text-align: left; }
.palette-item-active { background: var(--bg-700); color: var(--text-primary); }
.palette-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette-sub { font-size: 11px; color: var(--text-muted); }
.palette-kbd { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 5px; padding: 2px 6px; flex-shrink: 0; }
.palette-empty { padding: 22px 16px; font-size: 12.5px; color: var(--text-muted); text-align: center; }
.palette-foot { padding: 8px 14px; border-top: 1px solid var(--border-soft); font-size: 10.5px; color: var(--text-muted); }

/* Tab switches crossfade through the View Transitions API (see
   withTabTransition in App). Kept quick — this is a hint that the page
   changed, not a slideshow. */
::view-transition-old(root), ::view-transition-new(root) { animation-duration: 0.14s; }

/* Compact density (Settings > Appearance). Overrides ride a class on .app-root
   so the choice stays one preference flag, not a second stylesheet. Tightens
   the surfaces that repeat — cards, panels, table rows — and leaves one-off
   chrome (modals, forms) alone. */
.density-compact .content-scroll { padding: 12px 16px 28px; }
.density-compact .stack { gap: 10px; }
.density-compact .two-col { gap: 10px; }
.density-compact .cards-grid { gap: 8px; }
.density-compact .stat-card { padding: 9px 11px; border-radius: 10px; }
.density-compact .stat-value { font-size: 17px; }
.density-compact .stat-card-top { margin-bottom: 5px; }
.density-compact .panel-header { padding: 8px 12px; }
.density-compact .panel-body { padding: 10px 12px 12px; }
.density-compact .trades-table th { padding: 6px 8px; }
.density-compact .trades-table td { padding: 5px 8px; }
.density-compact .topbar { padding: 9px 16px; }

/* Honour the OS "reduce motion" setting. The .spin loader stays: it is the only
   signal that work is happening, which the spec counts as essential motion. The
   ticker's second copy exists purely so the scroll can loop seamlessly, so with
   the scroll off it would just read as a duplicate. */
@media (prefers-reduced-motion: reduce) {
  .ticker-track { animation: none; }
  .ticker-clone { display: none; }
  .modal-panel, .dt-popover, .lightbox-panel, .toast, .palette-panel { animation: none; }
  .chart-loading { animation: none; }
  .btn-primary:hover, .stat-card:hover { transform: none; }
  .sidebar, .nav-item, .btn, .stat-card, .trades-table tbody tr, .progress-fill { transition: none; }
}
`;

const BOOT_CSS = `
.app-booting { font-family: 'Inter', system-ui, sans-serif; background: var(--bg-950); color: var(--text-muted); min-height: 100vh; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 13px; padding: 24px; }
.spin { animation: spin 0.9s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
.boot-error { display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 520px; text-align: center; }
.boot-error h3 { font-family: 'Space Grotesk', sans-serif; font-size: 16px; margin: 0; color: var(--text-primary); }
.boot-error p { margin: 0; font-size: 13px; line-height: 1.6; }
.boot-error-detail { font-size: 11px; color: var(--loss); background: var(--bg-900); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; word-break: break-word; }
.btn { display: inline-flex; align-items: center; gap: 6px; font-family: 'Inter', sans-serif; font-size: 12.5px; font-weight: 600; border-radius: 8px; padding: 8px 13px; border: 1px solid transparent; cursor: pointer; margin-top: 6px; }
.btn-primary { background: var(--accent); color: #061019; }
`;


/* ============================================================================
   CONSTANTS
============================================================================ */
// Which stage of the trade a screenshot was taken at. Purely a UI grouping, so
// it stays here rather than in ./lib/trade with the data model.
const STAGES = ["Before Entry", "During Trade", "Exit"];
// A trade's screenshots all live in one storage key, so this is a per-trade
// ceiling, not a whole-journal one.
const SHOT_PAYLOAD_WARN_MB = 8;
// Tab history depth for the back/forward arrows. Deep enough that Back always
// covers real backtracking, bounded so a long session can't grow it forever.
const NAV_HISTORY_MAX = 50;
// Curated accent overrides (Settings > Appearance). Deliberately no green and
// no red — those two mean P&L and nothing else, everywhere in the app.
const ACCENT_PRESETS = ["#3e8fff", "#8b5cf6", "#06b6d4", "#c9a84c", "#f97316", "#ec4899", "#94a3b8"];

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
function compressImage(file, maxW = 900, quality = 0.58) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxW) { height = Math.round((height * maxW) / width); width = maxW; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ============================================================================
   EXPORT PLUMBING
   Desktop and web save files differently: the desktop shell (preload.cjs)
   exposes window.desktopExport for a native "Save As" dialog and real PDF
   generation, while the plain web build downloads through the browser. These
   helpers hide that split so each exporter just describes what to save.
   Every helper resolves to { ok, canceled?, path? } so callers can surface a
   toast without caring which path ran.
============================================================================ */
const desktop = typeof window !== "undefined" ? window.desktopExport : null;

// Convert a base64 string to a Blob without a data: URL round-trip, for the
// web fallback when saving binary (xlsx) exports.
function base64ToBlob(base64, mime) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function saveTextExport(filename, content, mime = "text/plain") {
  if (desktop?.isElectron) return desktop.saveText(filename, content);
  downloadBlob(new Blob([content], { type: mime }), filename);
  return { ok: true };
}
async function saveBinaryExport(filename, base64, mime) {
  if (desktop?.isElectron) return desktop.saveBinary(filename, base64);
  downloadBlob(base64ToBlob(base64, mime), filename);
  return { ok: true };
}

// Web-only PDF path: render the report HTML in an offscreen iframe and invoke
// the browser's print dialog, where the user picks "Save as PDF". The desktop
// build skips this and prints to a real PDF through the main process instead.
function printHtmlViaBrowser(html) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  // Data-URL screenshots are inline, so a short settle is enough for layout.
  setTimeout(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
    finally { setTimeout(() => iframe.remove(), 1000); }
  }, 400);
}

/* ============================================================================
   SMALL PRESENTATIONAL PRIMITIVES
============================================================================ */
function PnlText({ value, percent = false, digits = 2 }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className="mono" style={{ color: "var(--text-muted)" }}>—</span>;
  const positive = value > 0, negative = value < 0;
  const color = positive ? "var(--profit)" : negative ? "var(--loss)" : "var(--text-secondary)";
  const text = percent ? fmtPercent(value, digits) : fmtCurrency(value);
  return <span className="mono" style={{ color, fontWeight: 600 }}>{positive ? "+" : ""}{text}</span>;
}
function Card({ label, value, icon: Icon, sub, accentColor, help }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <span className="stat-label">
          {label}
          {help && <span className="stat-help" tabIndex={0} role="note" aria-label={help} title={help}>?</span>}
        </span>
        {Icon && <Icon size={15} style={{ color: accentColor || "var(--text-muted)" }} />}
      </div>
      <div className="stat-value mono">{value}</div>
      {sub !== undefined && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
function Badge({ children, tone = "neutral" }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function Modal({ title, onClose, children, wide }) {
  const panelRef = useRef(null);
  // Hold focus inside the dialog and freeze the page behind it. Without this,
  // Tab walks off into the page underneath and that page scrolls with it.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    // Anything with its own autoFocus has already claimed focus by now; only
    // take it if nothing inside the dialog has it.
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = panelRef.current.querySelectorAll(FOCUSABLE);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal-panel ${wide ? "modal-wide" : ""}`} ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
function ConfirmModal({ title, message, confirmLabel = "Confirm", danger, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="confirm-msg">{message}</p>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className={`btn ${danger ? "btn-danger-ghost" : "btn-primary"}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
function Field({ label, children, span }) {
  return <label className={`field ${span ? "field-span" : ""}`}><span className="field-label">{label}</span>{children}</label>;
}
/* Whole-panel zero state: what this place will hold, and the shortest path to
   putting something in it. */
function EmptyState({ icon: Icon = Activity, title, message, actionLabel, onAction }) {
  return (
    <div className="empty-state empty-state-lg">
      <Icon size={30} />
      {title && <h4>{title}</h4>}
      <p>{message}</p>
      {actionLabel && <button className="btn btn-primary" onClick={onAction}><PlusCircle size={14} /> {actionLabel}</button>}
    </div>
  );
}

/* One side of a scaled trade's fill legs — the rows the average entry or exit is
   built from. A <div> rather than a <label> like Field: several inputs per row
   means there is nothing for a single label to point at. */
function LegEditor({ side, label, legs = [], fill, onAdd, onChange, onRemove, emptyHint }) {
  return (
    <div className="field field-span">
      <span className="field-label">{label}</span>
      <div className="leg-list">
        {legs.length === 0 && <p className="hint">{emptyHint || "No fills yet."}</p>}
        {legs.map((leg, i) => (
          <div className="leg-row" key={leg.id}>
            <span className="leg-index mono">{i + 1}</span>
            <div className="leg-field">
              <span className="field-label">Price</span>
              <input className="input mono" type="number" step="any" value={leg.price} onChange={onChange(side, leg.id, "price")} />
            </div>
            <div className="leg-field">
              <span className="field-label">Quantity</span>
              <input className="input mono" type="number" step="any" value={leg.qty} onChange={onChange(side, leg.id, "qty")} />
            </div>
            <div className="leg-field leg-field-time">
              <span className="field-label">Date &amp; Time</span>
              <DateTimePicker value={leg.datetime} onChange={(v) => onChange(side, leg.id, "datetime")(v)} />
            </div>
            <button type="button" className="icon-btn icon-btn-danger leg-remove" title={`Remove fill ${i + 1}`} aria-label={`Remove fill ${i + 1}`} onClick={() => onRemove(side, leg.id)}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="leg-foot">
        <button type="button" className="btn btn-ghost" onClick={onAdd}><Plus size={13} /> Add fill</button>
        {fill && <span className="hint mono">{fmtNum(fill.qty, 4)} @ avg {fmtNum(fill.avgPrice, 4)}</span>}
      </div>
    </div>
  );
}

/* ============================================================================
   PROFILE MARK — editable avatar (replaces the static "TJ" badge). Click to
   upload a photo/logo; it's compressed client-side and stored in settings,
   so it persists the same way the rest of the app's settings do.
============================================================================ */
function ProfileMark({ size = 30, settings, setSettings }) {
  const fileRef = useRef(null);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const okTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!okTypes.includes(file.type)) return;
    try {
      setBusy(true);
      const dataUrl = await compressImage(file, 320, 0.85);
      setSettings((s) => ({ ...s, profileImage: dataUrl }));
    } catch { /* ignore unreadable image */ } finally { setBusy(false); }
  };
  const removeImage = (e) => {
    e.stopPropagation();
    setSettings((s) => ({ ...s, profileImage: null }));
  };

  return (
    <div
      className="profile-mark"
      style={{ width: size, height: size }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => fileRef.current?.click()}
      title="Click to change profile image"
      role="button"
    >
      {settings.profileImage ? <img src={settings.profileImage} alt="Profile" /> : <TrendingUp size={Math.round(size * 0.55)} />}
      {(busy || hover) && (
        <div className="profile-mark-overlay">{busy ? <Loader2 size={Math.round(size * 0.42)} className="spin" /> : <Pencil size={Math.round(size * 0.42)} />}</div>
      )}
      {settings.profileImage && !busy && (
        <button type="button" className="profile-mark-remove" onClick={removeImage} title="Remove photo"><X size={11} /></button>
      )}
      <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" hidden onChange={onFile} />
    </div>
  );
}

/* ============================================================================
   TICKER STRIP — signature element
============================================================================ */
function TickerStrip({ items }) {
  const row = (it, i, cloned) => (
    <div className="ticker-item" key={`${cloned ? "clone" : "real"}-${i}`}>
      <span className="ticker-key">{it.label}</span>
      <span className="mono ticker-val" style={{ color: it.color || "var(--text-primary)" }}>{it.value}</span>
    </div>
  );
  return (
    <div className="ticker-strip">
      <div className="ticker-track">
        {items.map((it, i) => row(it, i, false))}
        {/* Second pass is purely visual — it lets the marquee wrap seamlessly.
            Hidden from assistive tech so every stat isn't announced twice. */}
        <div className="ticker-clone" aria-hidden="true">{items.map((it, i) => row(it, i, true))}</div>
      </div>
    </div>
  );
}

/* ============================================================================
   CUSTOM DATE & TIME PICKER — with explicit Confirm button
============================================================================ */
function DTCalendar({ cursor, setCursor, selectedDate, onPick }) {
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return (
    <div>
      <div className="dt-cal-header">
        <button type="button" className="icon-btn" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={14} /></button>
        <span className="mono">{first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <button type="button" className="icon-btn" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={14} /></button>
      </div>
      <div className="dt-cal-grid dt-cal-dow">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="dt-cal-grid">
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />;
          const isSel = selectedDate && selectedDate.getFullYear() === year && selectedDate.getMonth() === month && selectedDate.getDate() === d;
          const isToday = (() => { const n = new Date(); return n.getFullYear() === year && n.getMonth() === month && n.getDate() === d; })();
          return <button type="button" key={i} className={`dt-day ${isSel ? "dt-day-sel" : ""} ${isToday && !isSel ? "dt-day-today" : ""}`} onClick={() => onPick(new Date(year, month, d))}>{d}</button>;
        })}
      </div>
    </div>
  );
}
function DateTimePicker({ value, onChange, required, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => parseLocalInputValue(value));
  const [cursor, setCursor] = useState(() => parseLocalInputValue(value));
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Seed the draft from the committed value as the popover opens, rather than in
  // an effect keyed on `open` — same result without the extra render pass.
  const toggleOpen = () => {
    if (!open) { const d = value ? parseLocalInputValue(value) : new Date(); setDraft(d); setCursor(d); }
    setOpen((o) => !o);
  };

  const pickDay = (d) => { const next = new Date(d); next.setHours(draft.getHours(), draft.getMinutes()); setDraft(next); setCursor(next); };
  const setHour = (h) => setDraft((d) => { const n = new Date(d); n.setHours(h); return n; });
  const setMinute = (m) => setDraft((d) => { const n = new Date(d); n.setMinutes(m); return n; });
  const confirm = () => { onChange(toLocalInputValue(draft)); setOpen(false); };
  const setNow = () => { const n = new Date(); setDraft(n); setCursor(n); };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);

  return (
    <div className="dt-picker" ref={ref}>
      <button type="button" className={`input dt-trigger ${!value && required && !disabled ? "dt-trigger-empty" : ""}`} onClick={toggleOpen} disabled={disabled}>
        <CalendarDays size={13} /> {value ? fmtDateTime(value) : "Select date & time…"}
      </button>
      {open && !disabled && (
        <div className="dt-popover">
          <DTCalendar cursor={cursor} setCursor={setCursor} selectedDate={draft} onPick={pickDay} />
          <div className="dt-time-row">
            <select className="input" value={draft.getHours()} onChange={(e) => setHour(parseInt(e.target.value, 10))}>
              {hours.map((h) => <option key={h} value={h}>{pad(h)}</option>)}
            </select>
            <span className="mono">:</span>
            <select className="input" value={Math.floor(draft.getMinutes() / 5) * 5} onChange={(e) => setMinute(parseInt(e.target.value, 10))}>
              {minutes.map((m) => <option key={m} value={m}>{pad(m)}</option>)}
            </select>
            <button type="button" className="btn btn-ghost dt-now-btn" onClick={setNow}>Now</button>
          </div>
          <div className="dt-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={confirm}><Check size={13} /> Confirm</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   STRATEGY MANAGER
============================================================================ */
function StrategyManager({ strategies, setStrategies, onClose }) {
  const [newName, setNewName] = useState("");
  const [editIdx, setEditIdx] = useState(null);
  const [editVal, setEditVal] = useState("");

  const add = () => {
    const v = newName.trim();
    if (!v || strategies.includes(v)) return;
    setStrategies((s) => [...s, v]);
    setNewName("");
  };
  const startEdit = (i) => { setEditIdx(i); setEditVal(strategies[i]); };
  const saveEdit = () => {
    const v = editVal.trim();
    if (!v) return;
    setStrategies((s) => s.map((x, i) => (i === editIdx ? v : x)));
    setEditIdx(null);
  };
  const [removeIdx, setRemoveIdx] = useState(null);
  const remove = (i) => setStrategies((s) => s.filter((_, idx) => idx !== i));

  return (
    <Modal title="Manage Strategies" onClose={onClose}>
      <div className="strategy-mgr-list">
        {strategies.map((s, i) => (
          <div className="strategy-mgr-row" key={s + i}>
            {editIdx === i ? (
              <input className="input" value={editVal} onChange={(e) => setEditVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} autoFocus />
            ) : (
              <span>{s}</span>
            )}
            <div className="strategy-mgr-actions">
              {editIdx === i ? (
                <button className="icon-btn" onClick={saveEdit}><Check size={13} /></button>
              ) : (
                <button className="icon-btn" onClick={() => startEdit(i)}><Pencil size={13} /></button>
              )}
              <button className="icon-btn icon-btn-danger" aria-label={`Remove ${s}`} onClick={() => setRemoveIdx(i)}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
        {strategies.length === 0 && <div className="hint">No strategies yet — add your first one below.</div>}
      </div>
      <div className="strategy-add-row">
        <input className="input" placeholder="New strategy name…" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn btn-primary" onClick={add}><Plus size={14} /> Add</button>
      </div>
      <div className="modal-footer"><button className="btn btn-ghost" onClick={onClose}>Done</button></div>
      {removeIdx !== null && (
        <ConfirmModal
          title="Remove Strategy" danger confirmLabel="Remove"
          message={`Remove "${strategies[removeIdx]}" from the strategy list? Existing trades keep their saved value.`}
          onConfirm={() => remove(removeIdx)} onClose={() => setRemoveIdx(null)}
        />
      )}
    </Modal>
  );
}

/* ============================================================================
   TRADE FORM
============================================================================ */
function TradeForm({ initial, seed, onSave, onClose, strategies, setStrategies, lastDefaults, symbolStats = [], checklistRules = DEFAULT_CHECKLIST_RULES, accounts = DEFAULT_SETTINGS.accounts, defaultAccountId }) {
  const [form, setForm] = useState(() => tradeToForm(initial || seed || emptyTrade({ ...lastDefaults, accountId: defaultAccountId || lastDefaults?.accountId }), accounts));
  const [sizeDriver, setSizeDriver] = useState(form.positionSize && !form.riskAmount ? "size" : "risk");
  // Scaled mode is a property of the trade, not a preference: a trade with legs
  // on file opens in the leg editor, anything else opens as a single fill.
  const [scaled, setScaled] = useState(() => (form.entries?.length || form.exits?.length) > 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showStrategyMgr, setShowStrategyMgr] = useState(false);
  const [symbolFocus, setSymbolFocus] = useState(false);
  const [symbolIdx, setSymbolIdx] = useState(-1);
  const fileRef = useRef(null);
  const [pendingStage, setPendingStage] = useState("Before Entry");
  const [pasteMsg, setPasteMsg] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Baseline for the dirty check. Taken from the normalized form rather than the
  // raw trade, or tradeToForm's own repairs (a legacy fees value moved under
  // commission) would read as an unsaved edit the moment the form opened.
  // Re-synced below when an existing trade's screenshots arrive, so that async
  // load isn't mistaken for a user edit either.
  const pristine = useRef(formSignature(form));

  useEffect(() => { if (initial) { const next = tradeToForm(initial, accounts); setForm(next); pristine.current = formSignature(next); } }, [initial?.screenshots]); // eslint-disable-line

  const requestClose = useCallback(() => {
    if (formSignature(form) !== pristine.current) setConfirmDiscard(true);
    else onClose();
  }, [form, onClose]);

  // Escape has to see the current form, but re-binding the listener on every
  // keystroke is pointless churn — the handler reads the latest callback from a
  // ref instead, so it binds once.
  const requestCloseRef = useRef(requestClose);
  useEffect(() => { requestCloseRef.current = requestClose; }, [requestClose]);

  // This form owns Escape while it is open (App defers to it) so that closing
  // always runs through the unsaved-changes guard above.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") requestCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stopDistance = useMemo(() => {
    const e = num(form.entryPrice), s = num(form.stopLoss);
    return (e !== null && s !== null && e !== s) ? Math.abs(e - s) : null;
  }, [form.entryPrice, form.stopLoss]);

  const preview = useMemo(() => computeTrade(form), [form]);

  const set = (k) => (e) => {
    const v = e && e.target ? e.target.value : e;
    setForm((f) => ({ ...f, [k]: v }));
  };
  const addTag = (raw) => {
    const tag = raw.trim();
    if (!tag) return;
    setForm((f) => (f.tags?.includes(tag) ? f : { ...f, tags: [...(f.tags || []), tag] }));
    setTagInput("");
  };
  const removeTag = (tag) => setForm((f) => ({ ...f, tags: (f.tags || []).filter((t) => t !== tag) }));
  const toggleChecklistRule = (rule) => setForm((f) => ({ ...f, checklist: { ...f.checklist, [rule]: !f.checklist?.[rule] } }));
  const symbolSuggestions = useMemo(() => {
    const q = (form.symbol || "").trim().toLowerCase();
    return symbolStats
      .filter((item) => item.symbol && (!q || item.symbol.toLowerCase().includes(q)))
      .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol))
      .slice(0, 8);
  }, [form.symbol, symbolStats]);
  const symbolMenuOpen = symbolFocus && symbolSuggestions.length > 0;
  const pickSymbol = (symbol) => { setForm((f) => ({ ...f, symbol })); setSymbolFocus(false); setSymbolIdx(-1); };
  // The form-level Enter handler advances to the next field, which would other-
  // wise fire instead of accepting the highlighted suggestion — so these keys
  // stop propagating once the menu has consumed them.
  const onSymbolKeyDown = (e) => {
    if (!symbolMenuOpen) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSymbolIdx((i) => (i + 1) % symbolSuggestions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSymbolIdx((i) => (i <= 0 ? symbolSuggestions.length - 1 : i - 1)); }
    else if (e.key === "Enter" && symbolIdx >= 0) { e.preventDefault(); e.stopPropagation(); pickSymbol(symbolSuggestions[symbolIdx].symbol); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setSymbolFocus(false); setSymbolIdx(-1); }
  };

  const onPriceOrStopChange = (key) => (e) => {
    const v = e.target.value;
    setForm((f) => {
      const next = { ...f, [key]: v };
      const e2 = num(key === "entryPrice" ? v : f.entryPrice);
      const s2 = num(key === "stopLoss" ? v : f.stopLoss);
      const sd = (e2 !== null && s2 !== null && e2 !== s2) ? Math.abs(e2 - s2) : null;
      if (sd) {
        // With legs, size is whatever was actually filled — it can't be solved
        // backwards from a risk figure, so moving the stop re-prices the risk
        // and never the size, whichever way the calculator is pointing.
        if (scaled) { if (f.positionSize !== "") next.riskAmount = String(round(num(f.positionSize, 0) * sd, 2)); }
        else if (sizeDriver === "risk" && f.riskAmount !== "") next.positionSize = String(round(num(f.riskAmount, 0) / sd, 6));
        else if (sizeDriver === "size" && f.positionSize !== "") next.riskAmount = String(round(num(f.positionSize, 0) * sd, 2));
      }
      return next;
    });
  };

  /* ---- fill legs ---- */
  const addLeg = (side) => setForm((f) => withDerivedFills({ ...f, [side]: [...(f[side] || []), emptyLeg()] }));
  const setLeg = (side, id, key) => (e) => {
    const v = e && e.target ? e.target.value : e;
    setForm((f) => withDerivedFills({ ...f, [side]: (f[side] || []).map((l) => (l.id === id ? { ...l, [key]: v } : l)) }));
  };
  const removeLeg = (side, id) => setForm((f) => withDerivedFills({ ...f, [side]: (f[side] || []).filter((l) => l.id !== id) }));

  /* Switching modes never throws a number away. Going scaled seeds the first leg
     from what the single-fill fields already say, so the trade means the same
     thing the instant it converts; coming back collapses the legs into the
     averages they represent, which is what the flat fields already mirror. */
  const toggleScaled = (on) => {
    if (on === scaled) return;
    setScaled(on);
    if (on) {
      setForm((f) => {
        const entries = f.entries?.length ? f.entries : (f.entryPrice || f.positionSize || f.entryDateTime
          ? [{ ...emptyLeg(), price: f.entryPrice, qty: f.positionSize, datetime: f.entryDateTime }] : [emptyLeg()]);
        const exits = f.exits?.length ? f.exits : (f.exitPrice || f.exitDateTime
          ? [{ ...emptyLeg(), price: f.exitPrice, qty: f.positionSize, datetime: f.exitDateTime }] : []);
        return withDerivedFills({ ...f, entries, exits });
      });
    } else {
      setForm((f) => ({ ...withDerivedFills(f), entries: [], exits: [] }));
    }
  };
  const entryFill = useMemo(() => aggregateLegs(form.entries), [form.entries]);
  const exitFill = useMemo(() => aggregateLegs(form.exits), [form.exits]);
  const openQty = entryFill && exitFill ? entryFill.qty - exitFill.qty : null;
  const feesTotal = (num(form.commission, 0) || 0) + (num(form.swap, 0) || 0);
  const onRiskChange = (e) => {
    const v = e.target.value;
    setSizeDriver("risk");
    setForm((f) => {
      const next = { ...f, riskAmount: v };
      if (stopDistance && v !== "") next.positionSize = String(round(num(v, 0) / stopDistance, 6));
      return next;
    });
  };
  const onSizeChange = (e) => {
    const v = e.target.value;
    setSizeDriver("size");
    setForm((f) => {
      const next = { ...f, positionSize: v };
      if (stopDistance && v !== "") next.riskAmount = String(round(num(v, 0) * stopDistance, 2));
      return next;
    });
  };

  const handleFiles = async (fileList) => {
    setErr("");
    const files = Array.from(fileList || []);
    const okTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    for (const file of files) {
      if (!okTypes.includes(file.type)) { setErr(`Unsupported file type: ${file.name}`); continue; }
      try {
        setBusy(true);
        const dataUrl = await readImageAsDataUrl(file);
        setForm((f) => ({ ...f, screenshots: [...(f.screenshots || []), { id: uid("SS"), name: file.name, stage: pendingStage, dataUrl }] }));
      } catch { setErr("Could not process image: " + file.name); } finally { setBusy(false); }
    }
  };
  const removeShot = (id) => setForm((f) => ({ ...f, screenshots: f.screenshots.filter((s) => s.id !== id) }));

  // Let the user paste a screenshot straight from the clipboard (Ctrl+V / Cmd+V)
  // anywhere in this form, instead of only via the file picker.
  useEffect(() => {
    const onPaste = (e) => {
      if (initial?._loadingShots) return; // avoid a race with the async screenshot fetch for an existing trade
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        handleFiles(files);
        setPasteMsg(`Pasted ${files.length} screenshot${files.length > 1 ? "s" : ""} · tagged "${pendingStage}"`);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pendingStage, initial?._loadingShots]); // eslint-disable-line

  useEffect(() => {
    if (!pasteMsg) return;
    const t = setTimeout(() => setPasteMsg(""), 2500);
    return () => clearTimeout(t);
  }, [pasteMsg]);

  const submit = () => {
    if (!form.symbol.trim()) { setErr("Asset / Symbol is required."); return; }
    if (scaled && !entryFill) { setErr("Add at least one entry fill with both a price and a quantity."); return; }
    if (!form.entryPrice) { setErr("Entry price is required."); return; }
    // In scaled mode the date fields are read-only mirrors of the legs, so
    // pointing at them here would name a field the user cannot type into.
    if (scaled && !form.entryDateTime) { setErr("Give at least one entry fill a date & time — the earliest one is the trade's entry time."); return; }
    if (!form.entryDateTime) { setErr("Entry date & time is required."); return; }
    if (scaled && form.status === "Closed" && !exitFill) { setErr("A closed trade needs at least one exit fill with a price and a quantity."); return; }
    if (form.status === "Closed" && !form.exitPrice) { setErr("Exit price is required for a closed trade."); return; }
    // Scaling out of more than went in isn't a partial close, it's a typo — and
    // it would silently under-report P&L, since only matched size earns any.
    if (openQty !== null && openQty < -1e-9) { setErr("Exit fills total more than the entry fills — check the quantities."); return; }
    setErr("");
    // fees stays the total of record; commission and swap are what was typed.
    // Written on every save so the two can never drift apart on disk.
    const next = withDerivedFills({ ...form, fees: String(round(feesTotal, 8)) });
    onSave(scaled ? next : { ...next, entries: [], exits: [] });
  };

  const handleFormKeyDown = (e) => {
    if (e.key !== "Enter") return;
    const tag = e.target.tagName.toLowerCase();
    if (tag === "textarea" || tag === "button") return;
    e.preventDefault();
    const focusable = Array.from(e.currentTarget.querySelectorAll("input.input, select.input"));
    const idx = focusable.indexOf(e.target);
    if (idx > -1 && idx < focusable.length - 1) focusable[idx + 1].focus(); else submit();
  };

  const approxSize = useMemo(() => (form.screenshots || []).reduce((s, sc) => s + sc.dataUrl.length * 0.75, 0) / (1024 * 1024), [form.screenshots]);
  const loadingShots = initial && initial._loadingShots;
  // Screenshots are kept at original quality and all of a trade's images share
  // one storage key, so a few phone-sized captures can make that single record
  // very large. Warn before it becomes a problem instead of failing on save.
  const shotsTooLarge = approxSize > SHOT_PAYLOAD_WARN_MB;

  return (
    <Modal title={initial ? `Edit Trade — ${form.id}` : "New Trade"} onClose={requestClose} wide>
      <div className="form-grid" onKeyDown={handleFormKeyDown}>
        <Field label="Symbol / Asset">
          <div className="autocomplete-wrap">
            <input
              className="input" placeholder="BTCUSDT, XAUUSD, AAPL…" value={form.symbol}
              role="combobox" aria-expanded={symbolMenuOpen} aria-autocomplete="list" aria-controls="symbol-suggestions"
              aria-activedescendant={symbolIdx >= 0 ? `symbol-opt-${symbolIdx}` : undefined}
              onFocus={() => { setSymbolFocus(true); setSymbolIdx(-1); }}
              onBlur={() => setTimeout(() => setSymbolFocus(false), 120)}
              onChange={(e) => { setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() })); setSymbolIdx(-1); }}
              onKeyDown={onSymbolKeyDown}
            />
            {symbolMenuOpen && (
              <div className="autocomplete-menu" id="symbol-suggestions" role="listbox">
                {symbolSuggestions.map((item, i) => (
                  <button
                    type="button" key={item.symbol} id={`symbol-opt-${i}`} role="option" aria-selected={i === symbolIdx}
                    className={`autocomplete-item ${i === symbolIdx ? "autocomplete-item-active" : ""}`}
                    onMouseEnter={() => setSymbolIdx(i)}
                    onMouseDown={(e) => { e.preventDefault(); pickSymbol(item.symbol); }}
                  >
                    <span className="mono">{item.symbol}</span><span>{item.count} use{item.count === 1 ? "" : "s"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field label="Market Type">
          <select className="input" value={form.marketType} onChange={set("marketType")}>{MARKET_TYPES.map((m) => <option key={m}>{m}</option>)}</select>
        </Field>
        {/* Only worth the row when there is a choice to make. With one account
            the trade still carries its id — it is just never in question. */}
        {accounts.length > 1 && (
          <Field label="Account">
            <select className="input" value={form.accountId} onChange={set("accountId")}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Direction">
          <div className="segmented">
            {DIRECTIONS.map((d) => <button type="button" key={d} className={`seg-btn ${form.direction === d ? "seg-active-" + d.toLowerCase() : ""}`} onClick={() => setForm((f) => ({ ...f, direction: d }))}>{d}</button>)}
          </div>
        </Field>
        <Field label="Status">
          <div className="segmented">
            {STATUS.map((s) => <button type="button" key={s} className={`seg-btn ${form.status === s ? "seg-active-plain" : ""}`} onClick={() => setForm((f) => ({ ...f, status: s }))}>{s}</button>)}
          </div>
        </Field>

        <Field label="Fills" span>
          <div className="segmented segmented-tight">
            <button type="button" className={`seg-btn ${!scaled ? "seg-active-plain" : ""}`} onClick={() => toggleScaled(false)}>Single Fill</button>
            <button type="button" className={`seg-btn ${scaled ? "seg-active-plain" : ""}`} onClick={() => toggleScaled(true)}><Layers size={13} /> Scaled / Partial</button>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            {scaled
              ? "Every fill is listed below. Entry price, exit price and position size are the size-weighted average of them, and update as you type."
              : "One entry, one exit. Switch to Scaled to log averaging in, scaling out, or a partial close."}
          </p>
        </Field>

        {scaled && (
          <>
            <LegEditor
              side="entries" label="Entry Fills" legs={form.entries} fill={entryFill}
              onAdd={() => addLeg("entries")} onChange={setLeg} onRemove={removeLeg}
            />
            <LegEditor
              side="exits" label="Exit Fills" legs={form.exits} fill={exitFill}
              onAdd={() => addLeg("exits")} onChange={setLeg} onRemove={removeLeg}
              emptyHint="No exit fills yet — the position is fully open."
            />
            <Field label="Fill Summary" span>
              <div className="calc-summary">
                <div className="readout-grid">
                  <div><span className="field-label">Avg Entry</span><div className="mono readout-val">{entryFill ? fmtNum(entryFill.avgPrice, 4) : "—"}</div></div>
                  <div><span className="field-label">Avg Exit</span><div className="mono readout-val">{exitFill ? fmtNum(exitFill.avgPrice, 4) : "—"}</div></div>
                  <div><span className="field-label">Size In / Out</span><div className="mono readout-val">{entryFill ? fmtNum(entryFill.qty, 4) : "—"} / {exitFill ? fmtNum(exitFill.qty, 4) : "—"}</div></div>
                  <div>
                    <span className="field-label">Still Open</span>
                    <div className="mono readout-val" style={{ color: openQty > 1e-9 ? "var(--accent)" : undefined }}>
                      {openQty === null ? "—" : fmtNum(Math.max(0, openQty), 4)}
                    </div>
                  </div>
                </div>
                {openQty !== null && openQty < -1e-9 && (
                  <p className="hint" style={{ color: "var(--loss)" }}><AlertTriangle size={12} /> Exit fills total more than the entry fills.</p>
                )}
                {openQty > 1e-9 && (
                  <p className="hint">Partial close — P&amp;L is realized on the {fmtNum(exitFill.qty, 4)} that has been closed out. The rest stays open.</p>
                )}
              </div>
            </Field>
          </>
        )}

        {/* Derived from the legs in scaled mode, so they are read-only mirrors
            there rather than a second place to type a conflicting number. */}
        <Field label={scaled ? "Entry Price (avg of fills)" : "Entry Price"}>
          <input className="input mono" type="number" step="any" value={form.entryPrice} onChange={onPriceOrStopChange("entryPrice")} disabled={scaled} />
        </Field>
        <Field label="Stop Loss"><input className="input mono" type="number" step="any" value={form.stopLoss} onChange={onPriceOrStopChange("stopLoss")} /></Field>
        <Field label="Take Profit"><input className="input mono" type="number" step="any" value={form.takeProfit} onChange={set("takeProfit")} /></Field>
        <Field label={scaled ? "Exit Price (avg of fills)" : "Actual Exit Price"}>
          <input className="input mono" type="number" step="any" value={form.exitPrice} onChange={set("exitPrice")} disabled={scaled} />
        </Field>

        <Field label={scaled ? "Entry Date & Time (first fill)" : "Entry Date & Time"}>
          <DateTimePicker value={form.entryDateTime} onChange={(v) => setForm((f) => ({ ...f, entryDateTime: v }))} required disabled={scaled} />
        </Field>
        <Field label={scaled ? "Exit Date & Time (last fill)" : "Exit Date & Time"}>
          <DateTimePicker value={form.exitDateTime} onChange={(v) => setForm((f) => ({ ...f, exitDateTime: v }))} disabled={scaled} />
        </Field>
        <Field label="Commission ($)"><input className="input mono" type="number" step="any" value={form.commission} onChange={set("commission")} placeholder="Broker commission" /></Field>
        <Field label="Swap / Overnight ($)"><input className="input mono" type="number" step="any" value={form.swap} onChange={set("swap")} placeholder="Financing, rollover, funding" /></Field>
        <Field label="Trade Grade">
          <select className="input" value={form.grade} onChange={set("grade")}>{GRADES.map((g) => <option key={g}>{g}</option>)}</select>
        </Field>
        <Field label="Total Fees (auto)">
          <div className="input input-readonly mono">{fmtCurrency(feesTotal)}</div>
        </Field>
        <Field label="MAE — Max Adverse Excursion ($)"><input className="input mono" type="number" step="any" value={form.mae} onChange={set("mae")} placeholder="Worst drawdown while open" /></Field>
        <Field label="MFE — Max Favorable Excursion ($)"><input className="input mono" type="number" step="any" value={form.mfe} onChange={set("mfe")} placeholder="Best unrealized gain while open" /></Field>

        <Field label="Strategy / Setup" span>
          <div className="strategy-row">
            <select className="input" value={form.strategy} onChange={set("strategy")}>
              <option value="">Select strategy…</option>
              {strategies.map((s) => <option key={s}>{s}</option>)}
            </select>
            <button type="button" className="icon-btn" title="Manage strategies" onClick={() => setShowStrategyMgr(true)}><SettingsIcon size={14} /></button>
          </div>
        </Field>

        <Field label="Position Size Calculator" span>
          <div className="calc-summary">
            <div className="calc-row">
              <div className="calc-input-group">
                <span className="field-label">Risk Amount ($)</span>
                <input className="input mono" type="number" step="any" value={form.riskAmount} onChange={onRiskChange} disabled={scaled} />
              </div>
              <Calculator size={16} className="calc-icon" />
              <div className="calc-input-group">
                <span className="field-label">Position Size{scaled ? " (from fills)" : ""}</span>
                <input className="input mono" type="number" step="any" value={form.positionSize} onChange={onSizeChange} disabled={scaled} />
              </div>
            </div>
            <div className="calc-facts">
              <span>Stop distance: <b className="mono">{stopDistance !== null ? fmtNum(stopDistance, 4) : "—"}</b></span>
              <span>Driven by: <b>{scaled ? "Entry Fills" : sizeDriver === "risk" ? "Risk Amount" : "Position Size"}</b></span>
            </div>
            <p className="hint">
              {scaled
                ? "Size is the total of your entry fills, so risk is calculated from it and your stop — not the other way around."
                : "Enter either field — the other updates automatically from your stop-loss distance. Enter Entry Price and Stop Loss first."}
            </p>
          </div>
        </Field>

        <Field label="Expected RR (auto)" span>
          <div className="calc-summary calc-summary-readout">
            <div className="readout-grid">
              <div><span className="field-label">Expected RR</span><div className="mono readout-val">{preview.expectedRR !== null ? `${fmtNum(preview.expectedRR)}R` : "—"}</div></div>
              <div><span className="field-label">Actual RR</span><div className="mono readout-val">{form.status === "Closed" && preview.actualRR !== null ? `${fmtNum(preview.actualRR)}R` : "—"}</div></div>
              <div><span className="field-label">Projected / Actual P&amp;L</span><div className="readout-val"><PnlText value={form.status === "Closed" ? preview.pnlAmount : null} /></div></div>
            </div>
          </div>
        </Field>

        <Field label="Tags" span>
          <div className="tag-input-row">
            <input
              className="input" placeholder="FOMO, Revenge, Planned, News… (Enter to add)"
              value={tagInput} onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); } }}
            />
            <button type="button" className="btn btn-ghost" onClick={() => addTag(tagInput)}><Plus size={13} /> Add</button>
          </div>
          {form.tags?.length > 0 && (
            <div className="strategy-chip-row" style={{ marginTop: 8 }}>
              {form.tags.map((tag) => (
                <span key={tag} className="badge badge-neutral tag-chip">{tag} <button type="button" onClick={() => removeTag(tag)}><X size={10} /></button></span>
              ))}
            </div>
          )}
        </Field>

        <Field label="Rule Checklist" span>
          <div className="checklist-grid">
            {checklistRules.map((rule) => (
              <label key={rule} className="checkbox-row">
                <input type="checkbox" checked={!!form.checklist?.[rule]} onChange={() => toggleChecklistRule(rule)} /> {rule}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Notes / Trade Thesis" span>
          <textarea className="input textarea" rows={4} value={form.notes} onChange={set("notes")} placeholder="Why did you take this trade? Confluences, plan, emotions, lessons…" />
        </Field>

        <Field label="Screenshots" span>
          {loadingShots ? (
            <div className="hint"><Loader2 size={13} className="spin" /> Loading screenshots…</div>
          ) : (
            <>
              <div className="shot-upload-row">
                <select className="input" style={{ maxWidth: 180 }} value={pendingStage} onChange={(e) => setPendingStage(e.target.value)}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
                <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={14} /> Upload image</button>
                <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
                <span className="hint"><ImageIcon size={12} /> or paste with Ctrl+V / ⌘V</span>
                <span className="hint" style={shotsTooLarge ? { color: "var(--loss)", fontWeight: 600 } : undefined}>{approxSize.toFixed(2)} MB attached {busy ? "· processing…" : ""}</span>
              </div>
              {shotsTooLarge && (
                <div className="form-error">
                  <AlertTriangle size={14} /> These screenshots total {approxSize.toFixed(1)} MB. Images are saved at full quality in a single record per trade — very large attachments can slow saving or hit a storage limit. Consider removing a few or attaching smaller crops.
                </div>
              )}
              {pasteMsg && <div className="form-note">{pasteMsg}</div>}
              {form.screenshots?.length > 0 && (
                <div className="shot-grid">
                  {form.screenshots.map((s) => (
                    <div className="shot-thumb" key={s.id}>
                      <img src={s.dataUrl} alt={s.name} />
                      <div className="shot-thumb-meta"><span>{s.stage}</span><button type="button" aria-label={`Remove ${s.stage} screenshot`} onClick={() => removeShot(s.id)}><X size={12} /></button></div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Field>
      </div>

      {err && <div className="form-error"><AlertTriangle size={14} /> {err}</div>}

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={requestClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}><Save size={14} /> Save Trade</button>
      </div>

      {showStrategyMgr && <StrategyManager strategies={strategies} setStrategies={setStrategies} onClose={() => setShowStrategyMgr(false)} />}
      {confirmDiscard && (
        <ConfirmModal
          title="Discard Changes" danger confirmLabel="Discard"
          message="This trade has unsaved changes. Close the form and lose them?"
          onConfirm={onClose} onClose={() => setConfirmDiscard(false)}
        />
      )}
    </Modal>
  );
}

/* ============================================================================
   IMAGE LIGHTBOX
============================================================================ */
function ImageLightbox({ shots, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex || 0);
  const total = shots.length;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, total - 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, onClose]);
  const shot = shots[idx];
  if (!shot) return null;
  return (
    <div className="lightbox-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lightbox-panel">
        <div className="lightbox-header">
          <span className="stat-label">{shot.stage}{total > 1 ? ` · ${idx + 1} / ${total}` : ""}</span>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="lightbox-img-wrap">
          <img src={shot.dataUrl} alt={shot.name} />
        </div>
        {total > 1 && (
          <div className="lightbox-nav">
            <button className="btn btn-ghost" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}><ChevronLeft size={16} /> Prev</button>
            <button className="btn btn-ghost" disabled={idx >= total - 1} onClick={() => setIdx((i) => i + 1)}>Next <ChevronRight size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   TRADE DETAIL
============================================================================ */
function TradeDetail({ trade, onClose, onEdit, onDelete, onCopy }) {
  const t = computeTrade(trade);
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const closeLightbox = useCallback(() => setLightboxIdx(null), []);
  const checkedRules = Object.entries(t.checklist || {}).filter(([, v]) => v).map(([k]) => k);
  return (
    <Modal title={`${t.symbol} · ${t.id}`} onClose={onClose} wide>
      <div className="detail-top">
        <Badge tone={t.direction === "Long" ? "profit" : "loss"}>{t.direction}</Badge>
        <Badge tone="neutral">{t.marketType}</Badge>
        <Badge tone={t.status === "Open" ? "accent" : "neutral"}>{t.status}</Badge>
        <Badge tone="gold">{t.grade}</Badge>
        {t.result && <Badge tone={t.result === "win" ? "profit" : t.result === "loss" ? "loss" : "neutral"}>{t.result.toUpperCase()}</Badge>}
        {t._scaled && <Badge tone="neutral">{t._entryFills + t._exitFills} FILLS</Badge>}
        {t._partial && <Badge tone="accent">PARTIAL — {fmtNum(t._openQty, 4)} OPEN</Badge>}
        {t._accountName && <Badge tone="neutral">{t._accountName}</Badge>}
        {(t.tags || []).map((tag) => <Badge key={tag} tone="accent">{tag}</Badge>)}
      </div>
      <div className="detail-grid">
        <DetailStat label={t._scaled ? "Entry Price (avg)" : "Entry Price"} value={fmtNum(t._entry)} />
        <DetailStat label="Stop Loss" value={fmtNum(t._stop)} />
        <DetailStat label="Take Profit" value={fmtNum(t._tp)} />
        <DetailStat label={t._scaled ? "Exit Price (avg)" : "Exit Price"} value={fmtNum(t._exit)} />
        <DetailStat label="Stop Distance" value={t.stopDistance !== null ? fmtNum(t.stopDistance, 4) : "—"} />
        <DetailStat label="Position Size" value={fmtNum(t._entryQty)} />
        {t._partial && <DetailStat label="Closed / Still Open" value={`${fmtNum(t._exitQty, 4)} / ${fmtNum(t._openQty, 4)}`} />}
        <DetailStat label="Commission" value={t._commission !== null ? fmtCurrency(t._commission) : "—"} />
        <DetailStat label="Swap / Overnight" value={t._swap !== null ? fmtCurrency(t._swap) : "—"} />
        <DetailStat label="Total Fees" value={fmtCurrency(t._fees)} />
        <DetailStat label="Risk Amount" value={fmtCurrency(t._risk)} />
        <DetailStat label="Expected RR" value={t.expectedRR !== null ? `${fmtNum(t.expectedRR)}R` : "—"} />
        <DetailStat label="Actual RR" value={t.actualRR !== null ? `${fmtNum(t.actualRR)}R` : "—"} />
        <DetailStat label="Duration" value={t.duration} />
        <DetailStat label="Entry Time" value={fmtDateTime(t.entryDateTime)} />
        <DetailStat label="Exit Time" value={fmtDateTime(t.exitDateTime)} />
        <DetailStat label="P&L Amount" value={<PnlText value={t.pnlAmount} />} />
        <DetailStat label="P&L %" value={<PnlText value={t.pnlPercent} percent />} />
        <DetailStat label="Strategy" value={t.strategy || "—"} />
        <DetailStat label="MAE (adverse)" value={t._mae !== null ? fmtCurrency(t._mae) : "—"} />
        <DetailStat label="MFE (favorable)" value={t._mfe !== null ? fmtCurrency(t._mfe) : "—"} />
      </div>
      {t._scaled && (
        <div className="detail-notes" style={{ marginTop: 14 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>Fills</div>
          <div className="table-wrap">
            <table className="trades-table compact-table">
              <thead><tr><th>Side</th><th>#</th><th>Price</th><th>Quantity</th><th>Time</th></tr></thead>
              <tbody>
                {[["Entry", t.entries], ["Exit", t.exits]].flatMap(([sideLabel, legs]) => (legs || []).map((leg, i) => (
                  <tr key={`${sideLabel}-${leg.id || i}`}>
                    <td><Badge tone={sideLabel === "Entry" ? "accent" : "neutral"}>{sideLabel}</Badge></td>
                    <td className="mono muted">{i + 1}</td>
                    <td className="mono">{fmtNum(num(leg.price), 4)}</td>
                    <td className="mono">{fmtNum(num(leg.qty), 4)}</td>
                    <td className="mono">{leg.datetime ? fmtDateTime(leg.datetime) : "—"}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {checkedRules.length > 0 && (
        <div className="detail-notes" style={{ marginTop: 14 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>Rule Checklist</div>
          <div className="checklist-grid">{checkedRules.map((rule) => <span key={rule} className="checklist-done"><Check size={12} /> {rule}</span>)}</div>
        </div>
      )}
      {t.notes && <div className="detail-notes"><div className="stat-label" style={{ marginBottom: 6 }}>Trade Thesis / Notes</div><p>{t.notes}</p></div>}
      {t._loadingShots && <div className="hint" style={{ marginTop: 14 }}><Loader2 size={13} className="spin" /> Loading screenshots…</div>}
      {!t._loadingShots && t.screenshots?.length > 0 && (
        <div className="detail-shots">
          <div className="stat-label" style={{ marginBottom: 8 }}>Screenshot Gallery</div>
          <div className="shot-grid">
            {t.screenshots.map((s, si) => (
              <div className="shot-thumb shot-thumb-lg" key={s.id}>
                <img src={s.dataUrl} alt={s.name} style={{ cursor: "zoom-in" }} onClick={() => setLightboxIdx(si)} />
                <div className="shot-thumb-meta"><span>{s.stage}</span><button type="button" onClick={() => downloadDataUrl(s.dataUrl, `${t.id}-${s.stage.replace(/\s+/g, "_")}.jpg`)}><Download size={12} /></button></div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="modal-footer">
        <button className="btn btn-danger-ghost" onClick={() => onDelete(t.id)}><Trash2 size={14} /> Delete</button>
        <button className="btn btn-ghost" onClick={() => onCopy(t)}><Copy size={14} /> Copy Trade</button>
        <button className="btn btn-primary" onClick={() => onEdit(t)}><Pencil size={14} /> Edit Trade</button>
      </div>
      {lightboxIdx !== null && t.screenshots?.length > 0 && (
        <ImageLightbox shots={t.screenshots} startIndex={lightboxIdx} onClose={closeLightbox} />
      )}
    </Modal>
  );
}
function DetailStat({ label, value }) { return <div className="detail-stat"><span className="stat-label">{label}</span><span className="mono detail-stat-val">{value}</span></div>; }

/* ============================================================================
   FILTERS BAR
============================================================================ */
function FiltersBar({ filters, setFilters, assets, strategies, tags = [] }) {
  const [open, setOpen] = useState(false);
  // The search term lives here and only lands in the shared filters once typing
  // pauses. Committing per keystroke re-filters the whole journal and schedules
  // a write of the entire preferences blob to storage on every character.
  const [searchDraft, setSearchDraft] = useState(filters.search);
  useEffect(() => {
    if (searchDraft === filters.search) return undefined;
    const id = setTimeout(() => setFilters((f) => ({ ...f, search: searchDraft })), 250);
    return () => clearTimeout(id);
  }, [searchDraft, filters.search, setFilters]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const applyPreset = (datePreset) => setFilters((f) => ({ ...f, datePreset, ...(datePreset !== "custom" ? { dateFrom: "", dateTo: "" } : {}) }));
  // Resets the draft too — it is the only thing that clears search from outside
  // the input, so no separate syncing effect is needed.
  const reset = () => { setSearchDraft(""); setFilters(DEFAULT_FILTERS); };
  const activeCount = Object.values(filters).filter(Boolean).length;
  return (
    <div className="filters-bar">
      <div className="filters-row">
        <div className="search-box"><Search size={14} /><input placeholder="Search symbol, strategy, notes…" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} /></div>
        <button className={`btn ${filters.status === "Open" ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilters((f) => ({ ...f, status: f.status === "Open" ? "" : "Open" }))}>Open Trades</button>
        <button className={`btn ${filters.status === "Closed" ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilters((f) => ({ ...f, status: f.status === "Closed" ? "" : "Closed" }))}>Closed Trades</button>
        <button className={`btn ${filters.datePreset === "today" ? "btn-primary" : "btn-ghost"}`} onClick={() => applyPreset(filters.datePreset === "today" ? "" : "today")}>Today's Trades</button>
        <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)}><Filter size={14} /> Filters {activeCount > 0 && <span className="filter-count">{activeCount}</span>} {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
        {activeCount > 0 && <button className="btn btn-ghost" onClick={reset}><RotateCcw size={14} /> Reset</button>}
      </div>
      {open && (
        <div className="filters-expanded">
          <Field label="Date Preset">
            <select className="input" value={filters.datePreset} onChange={(e) => applyPreset(e.target.value)}>
              <option value="">All dates</option><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option><option value="custom">Custom range</option>
            </select>
          </Field>
          <Field label="From"><input className="input" type="date" value={filters.dateFrom} onChange={set("dateFrom")} /></Field>
          <Field label="To"><input className="input" type="date" value={filters.dateTo} onChange={set("dateTo")} /></Field>
          <Field label="Asset"><select className="input" value={filters.asset} onChange={set("asset")}><option value="">All assets</option>{assets.map((a) => <option key={a}>{a}</option>)}</select></Field>
          <Field label="Strategy"><select className="input" value={filters.strategy} onChange={set("strategy")}><option value="">All strategies</option>{strategies.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Status"><select className="input" value={filters.status} onChange={set("status")}><option value="">Open &amp; Closed</option>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Market Type"><select className="input" value={filters.marketType} onChange={set("marketType")}><option value="">All markets</option>{MARKET_TYPES.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Direction"><select className="input" value={filters.direction} onChange={set("direction")}><option value="">Long &amp; Short</option>{DIRECTIONS.map((d) => <option key={d}>{d}</option>)}</select></Field>
          <Field label="Result"><select className="input" value={filters.result} onChange={set("result")}><option value="">Win &amp; Loss</option><option value="win">Winning trades</option><option value="loss">Losing trades</option></select></Field>
          <Field label="Tag"><select className="input" value={filters.tag} onChange={set("tag")}><option value="">All tags</option>{tags.map((tg) => <option key={tg}>{tg}</option>)}</select></Field>
          <Field label="RR min"><input className="input mono" type="number" step="any" value={filters.rrMin} onChange={set("rrMin")} /></Field>
          <Field label="RR max"><input className="input mono" type="number" step="any" value={filters.rrMax} onChange={set("rrMax")} /></Field>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   TRADES TABLE (paginated for scale)
============================================================================ */
/* Which trades-table columns can be switched off, in display order. Symbol and
   P&L stay locked on — a row without either says nothing. The checkbox and
   actions columns aren't listed: they're controls, not data. */
const TRADE_COLUMNS = [
  { key: "id", label: "ID" },
  { key: "account", label: "Account" },
  { key: "symbol", label: "Symbol", locked: true },
  { key: "marketType", label: "Market" },
  { key: "direction", label: "Direction" },
  { key: "entryDateTime", label: "Entry" },
  { key: "exitDateTime", label: "Exit" },
  { key: "pnlAmount", label: "P&L", locked: true },
  { key: "pnlPercent", label: "P&L %" },
  { key: "expectedRR", label: "Exp RR" },
  { key: "actualRR", label: "Actual RR" },
  { key: "grade", label: "Grade" },
  { key: "status", label: "Status" },
];
function TradesTable({ trades, onView, onEdit, onDelete, onCopy, onBulkDelete, onToast, showAccount = false, hiddenColumns, onToggleColumn }) {
  const [sortKey, setSortKey] = useState("entryDateTime");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(0);
  // One selection drives every bulk action. Compare is just the case where
  // exactly two rows are picked, so the row checkbox means the same thing
  // regardless of which action the user ends up taking.
  const [selectedIds, setSelectedIds] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef(null);
  const pageSize = 50;
  const hidden = hiddenColumns || [];
  const show = (key) => !hidden.includes(key);
  // Memoized: the keyboard-nav effect below depends on it, and the raw arrow
  // would re-subscribe that listener every render.
  const toggleSelected = useCallback((id) => setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])), []);

  // Close the column picker on any click outside it.
  useEffect(() => {
    if (!colMenuOpen) return;
    const onDoc = (e) => { if (!colMenuRef.current?.contains(e.target)) setColMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [colMenuOpen]);
  const selectedTrades = useMemo(() => trades.filter((t) => selectedIds.includes(t.id)), [trades, selectedIds]);
  const compareTrades = selectedTrades.slice(0, 2);

  const sorted = useMemo(() => {
    // Decorate–sort–undecorate: the sort key is derived once per row, not once
    // per comparison — a comparator that calls new Date() re-parses each date
    // O(n log n) times.
    const isDateKey = /Date/.test(sortKey);
    const nullsLast = sortKey === "pnlAmount" || sortKey === "actualRR";
    const keyed = trades.map((t) => {
      let v = t[sortKey];
      if (nullsLast) v = v ?? -Infinity;
      else if (isDateKey && typeof v === "string") v = new Date(v).getTime() || 0;
      return { v, t };
    });
    keyed.sort((a, b) => {
      if (a.v < b.v) return sortDir === "asc" ? -1 : 1;
      if (a.v > b.v) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return keyed.map((k) => k.t);
  }, [trades, sortKey, sortDir]);

  useEffect(() => { setPage(0); }, [trades.length, sortKey, sortDir]);

  // Filters can pull rows out from under a selection. Dropping ids whose row is
  // gone keeps the count honest and stops a bulk delete from reaching a trade
  // the user can no longer see. Returning the original array when nothing was
  // pruned avoids a re-render loop, since this runs on every `trades` identity.
  useEffect(() => {
    setSelectedIds((ids) => {
      if (!ids.length) return ids;
      const visible = new Set(trades.map((t) => t.id));
      const next = ids.filter((id) => visible.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, [trades]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  // Memoized so the keyboard-nav effect's identity check means something.
  const pageItems = useMemo(() => sorted.slice(page * pageSize, page * pageSize + pageSize), [sorted, page]);

  /* ---- keyboard row cursor ----
     j/k or ↑/↓ walk the visible page, Enter opens the row, E edits it, X
     toggles its selection. The cursor is clamped at read time instead of being
     reset by an effect when the list shrinks under it (sort, filter, page).
     Every overlay in the app (Modal, palette, lightbox path through Modal)
     freezes body scroll, so `overflow: hidden` doubles as the "something is
     open above this table" check without the table knowing about any of them. */
  const [cursor, setCursor] = useState(-1);
  const cursorIdx = Math.min(cursor, pageItems.length - 1);
  const tbodyRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (document.body.style.overflow === "hidden") return;
      if (!pageItems.length) return;
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" || e.key === "j" ? 1 : -1;
        setCursor((c) => Math.max(0, Math.min(pageItems.length - 1, Math.min(c, pageItems.length - 1) + delta)));
      } else if (cursorIdx >= 0) {
        const t = pageItems[cursorIdx];
        if (e.key === "Enter") { e.preventDefault(); onView(t); }
        else if (e.key.toLowerCase() === "e") { e.preventDefault(); onEdit(t); }
        else if (e.key.toLowerCase() === "x") { e.preventDefault(); toggleSelected(t.id); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageItems, cursorIdx, onView, onEdit, toggleSelected]);
  useEffect(() => {
    if (cursorIdx >= 0) tbodyRef.current?.children[cursorIdx]?.scrollIntoView({ block: "nearest" });
  }, [cursorIdx]);

  // The header checkbox covers the current page only — with pagination, one
  // click silently selecting rows on other pages is a trap when the next click
  // is Delete.
  const pageIds = pageItems.map((t) => t.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const somePageSelected = pageIds.some((id) => selectedIds.includes(id));
  const headerCbRef = useRef(null);
  useEffect(() => {
    if (headerCbRef.current) headerCbRef.current.indeterminate = somePageSelected && !allPageSelected;
  }, [somePageSelected, allPageSelected]);
  const togglePageSelection = () => {
    setSelectedIds((ids) => (allPageSelected ? ids.filter((id) => !pageIds.includes(id)) : [...new Set([...ids, ...pageIds])]));
  };

  const exportSelectedCSV = async () => {
    setExporting(true);
    try {
      const res = await saveTextExport(`BrijTradeJournal_Selected_${isoDate(new Date())}.csv`, tradesToCSV(selectedTrades), "text/csv;charset=utf-8");
      if (res && !res.canceled) {
        if (res.ok) onToast?.({ message: `Exported ${selectedTrades.length} trade${selectedTrades.length > 1 ? "s" : ""}${res.path ? "" : " to your downloads"}`, tone: "profit" });
        else onToast?.({ message: `Export failed${res.error ? `: ${res.error}` : ""}`, tone: "loss" });
      }
    } catch (e) {
      console.error("Selected-trades CSV export failed", e);
      onToast?.({ message: "Export failed", tone: "loss" });
    } finally {
      setExporting(false);
    }
  };

  const th = (key, label) => {
    const active = sortKey === key;
    return (
      <th
        className="th-sortable" title={`Sort by ${label}`}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        onClick={() => { if (active) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(key); setSortDir("desc"); } }}
      >
        {label}{" "}
        {active
          ? (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
          : <ChevronDown size={11} className="th-sort-hint" />}
      </th>
    );
  };

  if (trades.length === 0) return <div className="empty-state"><Activity size={26} /><p>No trades match the current filters — loosen or clear them above.</p></div>;

  return (
    <div className="table-wrap">
      <div className="table-toolbar" ref={colMenuRef}>
        <button className="btn btn-ghost" onClick={() => setColMenuOpen((o) => !o)} aria-expanded={colMenuOpen} aria-haspopup="true">
          <Table2 size={13} /> Columns <ChevronDown size={12} />
        </button>
        {colMenuOpen && (
          <div className="column-menu" role="menu">
            {TRADE_COLUMNS.filter((c) => c.key !== "account" || showAccount).map((c) => (
              <label key={c.key} className={`column-menu-item ${c.locked ? "column-locked" : ""}`} title={c.locked ? "Always shown" : undefined}>
                <input type="checkbox" checked={show(c.key)} disabled={c.locked} onChange={() => onToggleColumn?.(c.key)} />
                {c.label}
              </label>
            ))}
          </div>
        )}
      </div>
      {selectedIds.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <span className="bulk-count" role="status">{selectedIds.length} trade{selectedIds.length > 1 ? "s" : ""} selected</span>
          <div className="bulk-actions">
            {/* Compare is a two-trade view by construction, so it only appears
                once the selection is exactly a pair. */}
            {selectedIds.length === 2 && <button className="btn btn-primary" onClick={() => setCompareOpen(true)}>Compare</button>}
            <button className="btn btn-ghost" onClick={exportSelectedCSV} disabled={exporting}>
              {exporting ? <Loader2 size={13} className="spin" /> : <FileSpreadsheet size={13} />} Export CSV
            </button>
            <button className="btn btn-danger-ghost" onClick={() => onBulkDelete?.(selectedIds)}><Trash2 size={13} /> Delete</button>
            <button className="btn btn-ghost" onClick={() => setSelectedIds([])}>Clear</button>
          </div>
        </div>
      )}
      <table className="trades-table">
        <thead>
          <tr>
            <th>
              <input
                ref={headerCbRef} type="checkbox" checked={allPageSelected} onChange={togglePageSelection}
                aria-label={allPageSelected ? "Deselect all trades on this page" : "Select all trades on this page"}
                title={allPageSelected ? "Deselect all on this page" : "Select all on this page"}
              />
            </th>
            {show("id") && th("id", "ID")}{showAccount && show("account") && th("_accountName", "Account")}{th("symbol", "Symbol")}{show("marketType") && th("marketType", "Market")}{show("direction") && th("direction", "Dir")}{show("entryDateTime") && th("entryDateTime", "Entry")}{show("exitDateTime") && th("exitDateTime", "Exit")}{th("pnlAmount", "P&L")}{show("pnlPercent") && th("pnlPercent", "P&L %")}{show("expectedRR") && th("expectedRR", "Exp RR")}{show("actualRR") && th("actualRR", "Actual RR")}{show("grade") && th("grade", "Grade")}{show("status") && th("status", "Status")}<th></th></tr>
        </thead>
        <tbody ref={tbodyRef}>
          {pageItems.map((t, i) => (
            <tr key={t.id} className={`${t.result === "win" ? "row-win" : t.result === "loss" ? "row-loss" : ""} ${selectedIds.includes(t.id) ? "row-selected" : ""} ${i === cursorIdx ? "row-cursor" : ""}`} onClick={() => onView(t)}>
              <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${t.id}`} checked={selectedIds.includes(t.id)} onChange={() => toggleSelected(t.id)} /></td>
              {show("id") && <td className="mono muted">{t.id}</td>}
              {showAccount && show("account") && <td className="muted">{t._accountName}</td>}
              <td className="cell-strong">
                {t.symbol}
                {/* Two marks worth carrying into the table: a trade built from
                    several fills, and one only part-way out of the market. */}
                {t._scaled && <span className="cell-mark" title={`${t._entryFills + t._exitFills} fills`}><Layers size={11} /></span>}
                {t._partial && <span className="cell-mark cell-mark-accent" title={`Partial close — ${fmtNum(t._openQty, 4)} still open`}>PART</span>}
              </td>
              {show("marketType") && <td><Badge tone="neutral">{t.marketType}</Badge></td>}
              {show("direction") && <td><Badge tone={t.direction === "Long" ? "profit" : "loss"}>{t.direction}</Badge></td>}
              {show("entryDateTime") && <td className="mono">{fmtDate(t.entryDateTime)}</td>}
              {show("exitDateTime") && <td className="mono">{t.exitDateTime ? fmtDate(t.exitDateTime) : "—"}</td>}
              <td><PnlText value={t.pnlAmount} /></td>
              {show("pnlPercent") && <td><PnlText value={t.pnlPercent} percent /></td>}
              {show("expectedRR") && <td className="mono">{t.expectedRR !== null ? `${fmtNum(t.expectedRR)}R` : "—"}</td>}
              {show("actualRR") && <td className="mono">{t.actualRR !== null ? `${fmtNum(t.actualRR)}R` : "—"}</td>}
              {show("grade") && <td><Badge tone="gold">{t.grade}</Badge></td>}
              {show("status") && <td><Badge tone={t.status === "Open" ? "accent" : "neutral"}>{t.status}</Badge></td>}
              <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-ghost row-edit-btn" aria-label={`Edit ${t.id}`} onClick={() => onEdit(t)}><Pencil size={12} /> Edit</button>
                <button className="icon-btn" title="Copy trade" aria-label={`Copy ${t.id}`} onClick={() => onCopy(t)}><Copy size={13} /></button>
                <button className="icon-btn icon-btn-danger" title="Delete trade" aria-label={`Delete ${t.id}`} onClick={() => onDelete(t.id)}><Trash2 size={13} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > pageSize && (
        <div className="pager">
          <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="hint">Page {page + 1} of {totalPages} · {sorted.length} trades</span>
          <button className="btn btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
      {compareOpen && compareTrades.length === 2 && <TradeCompareModal trades={compareTrades} onClose={() => setCompareOpen(false)} />}
    </div>
  );
}
function TradeCompareModal({ trades, onClose }) {
  const [a, b] = trades;
  const rows = [
    ["Symbol", a.symbol, b.symbol],
    ["Direction", a.direction, b.direction],
    ["Entry Price", fmtNum(a._entry), fmtNum(b._entry)],
    ["Exit Price", fmtNum(a._exit), fmtNum(b._exit)],
    ["Expected RR", a.expectedRR !== null ? `${fmtNum(a.expectedRR)}R` : "—", b.expectedRR !== null ? `${fmtNum(b.expectedRR)}R` : "—"],
    ["Actual RR", a.actualRR !== null ? `${fmtNum(a.actualRR)}R` : "—", b.actualRR !== null ? `${fmtNum(b.actualRR)}R` : "—"],
    ["P&L Amount", fmtSignedCurrency(a.pnlAmount), fmtSignedCurrency(b.pnlAmount)],
    ["P&L %", fmtSignedPercent(a.pnlPercent), fmtSignedPercent(b.pnlPercent)],
    ["Duration", a.duration, b.duration],
    ["Grade", a.grade, b.grade],
    ["Strategy", a.strategy || "—", b.strategy || "—"],
  ];
  return (
    <Modal title="Compare Trades" onClose={onClose}>
      <div className="table-wrap">
        <table className="trades-table compact-table">
          <thead><tr><th>Metric</th><th>{a.id}</th><th>{b.id}</th></tr></thead>
          <tbody>{rows.map(([label, av, bv]) => <tr key={label}><td className="cell-strong">{label}</td><td className="mono">{av}</td><td className="mono">{bv}</td></tr>)}</tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ============================================================================
   PERFORMANCE CALENDAR
============================================================================ */
function PerformanceCalendar({ trades, onSelectDay, preferences, setPreferences }) {
  const [noteDate, setNoteDate] = useState(null);
  const dayNotes = preferences.dayNotes || {};
  const saveDayNote = (key, text) => setPreferences((p) => ({ ...p, dayNotes: { ...p.dayNotes, [key]: text } }));
  const [cursor, setCursorState] = useState(() => preferences.calendarCursor ? new Date(preferences.calendarCursor) : new Date());
  const setCursor = (next) => {
    setCursorState(next);
    setPreferences((p) => ({ ...p, calendarCursor: isoDate(next) }));
  };
  const calendarView = preferences.calendarView || "monthly";
  const setCalendarView = (view) => setPreferences((p) => ({ ...p, calendarView: view }));
  const viewRange = dateRangeForPreset(calendarView, cursor, preferences.calendar?.dateFrom, preferences.calendar?.dateTo);
  const scopedTrades = useMemo(() => {
    if (!viewRange.from && !viewRange.to) return trades;
    return trades.filter((t) => dateInRange(t.exitDateTime || t.entryDateTime, viewRange.from, viewRange.to));
  }, [trades, viewRange.from, viewRange.to]);
  const scopedStats = summarize(scopedTrades);
  const byDay = useMemo(() => {
    const map = {};
    scopedTrades.filter((t) => t.status === "Closed" && t.pnlAmount !== null && t.exitDateTime).forEach((t) => {
      const k = isoDate(t.exitDateTime);
      if (!k) return;
      if (!map[k]) map[k] = { pnl: 0, count: 0 };
      map[k].pnl += t.pnlAmount; map[k].count += 1;
    });
    return map;
  }, [scopedTrades]);
  const byMonth = useMemo(() => {
    const map = {};
    scopedTrades.filter((t) => t.status === "Closed" && t.pnlAmount !== null && t.exitDateTime).forEach((t) => {
      const k = monthKey(t.exitDateTime);
      if (!k) return;
      if (!map[k]) map[k] = { pnl: 0, count: 0 };
      map[k].pnl += t.pnlAmount; map[k].count += 1;
    });
    return map;
  }, [scopedTrades]);

  // Prev/next move by whatever period is on screen, so stepping a daily view
  // walks days rather than jumping a whole month.
  const step = (dir) => {
    const d = new Date(cursor);
    if (calendarView === "daily") d.setDate(d.getDate() + dir);
    else if (calendarView === "weekly") d.setDate(d.getDate() + dir * 7);
    else if (calendarView === "yearly") d.setFullYear(d.getFullYear() + dir);
    else d.setMonth(d.getMonth() + dir);
    setCursor(d);
  };
  const periodTitle = () => {
    if (calendarView === "daily") return cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (calendarView === "weekly") {
      const s = startOfWeek(cursor);
      const e = new Date(s); e.setDate(s.getDate() + 6);
      return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    if (calendarView === "yearly") return String(cursor.getFullYear());
    if (calendarView === "custom") return viewRange.from || viewRange.to ? `${viewRange.from || "…"} → ${viewRange.to || "…"}` : "All Dates";
    return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  };

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const maxAbs = Math.max(1, ...Object.values(byDay).map((v) => Math.abs(v.pnl)));
  const maxMonthAbs = Math.max(1, ...Object.values(byMonth).map((v) => Math.abs(v.pnl)));
  const heatBg = (pnl, max) => {
    const intensity = Math.min(1, Math.abs(pnl) / max);
    return pnl >= 0 ? `rgba(34,197,94,${0.12 + intensity * 0.35})` : `rgba(240,69,91,${0.12 + intensity * 0.35})`;
  };
  // One day cell, shared by the weekly and monthly grids.
  const dayCell = (key, label, i) => {
    const info = byDay[key];
    return (
      <div
        key={i} className="calendar-cell" style={{ background: info ? heatBg(info.pnl, maxAbs) : "transparent" }} role="button" tabIndex={0}
        onClick={() => info && onSelectDay(key)}
        onKeyDown={(e) => { if (info && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelectDay(key); } }}
      >
        <button type="button" className="daynote-btn" title="Day note" aria-label={`Journal note for ${key}`} onClick={(e) => { e.stopPropagation(); setNoteDate(key); }}><Pencil size={10} /></button>
        {dayNotes[key] && <span className="daynote-dot" title="Has a note" />}
        <span className="calendar-daynum">{label}</span>
        {info && <span className="mono calendar-pnl" style={{ color: info.pnl >= 0 ? "var(--profit)" : "var(--loss)" }}>{fmtCurrency(info.pnl)}</span>}
        {info && <span className="calendar-count">{info.count} trade{info.count > 1 ? "s" : ""}</span>}
      </div>
    );
  };

  return (
    <div className="stack">
      <div className="calendar-card">
        <div className="calendar-header">
          <h4>Calendar View · {periodTitle()}</h4>
          <div className="segmented segmented-tight">
            {["daily", "weekly", "monthly", "yearly", "custom"].map((view) => (
              <button key={view} type="button" className={`seg-btn ${calendarView === view ? "seg-active-plain" : ""}`} onClick={() => setCalendarView(view)}>{view[0].toUpperCase() + view.slice(1)}</button>
            ))}
          </div>
        </div>
        {calendarView === "custom" && (
          <div className="filters-expanded" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
            <Field label="Custom From"><input className="input" type="date" value={preferences.calendar?.dateFrom || ""} onChange={(e) => setPreferences((p) => ({ ...p, calendar: { ...p.calendar, dateFrom: e.target.value } }))} /></Field>
            <Field label="Custom To"><input className="input" type="date" value={preferences.calendar?.dateTo || ""} onChange={(e) => setPreferences((p) => ({ ...p, calendar: { ...p.calendar, dateTo: e.target.value } }))} /></Field>
          </div>
        )}
        <div className="cards-grid" style={{ marginTop: 12 }}>
          <Card label="View P&L" value={<PnlText value={scopedStats.net} />} icon={TrendingUp} />
          <Card label="View Trades" value={scopedTrades.length} icon={ListChecks} sub={`${scopedStats.count} closed`} />
          <Card label="View Win Rate" value={scopedStats.winRate !== null ? fmtPercent(scopedStats.winRate, 1) : "—"} icon={Target} />
          <Card label="View Avg RR" value={scopedStats.avgRR !== null ? `${fmtNum(scopedStats.avgRR)}R` : "—"} icon={Percent} />
        </div>
      </div>
      <div className="calendar-card">
        <div className="calendar-header">
          {calendarView === "custom"
            ? <span />
            : <button className="icon-btn" aria-label="Previous period" onClick={() => step(-1)}><ChevronLeft size={16} /></button>}
          <h4>{periodTitle()}</h4>
          {calendarView === "custom"
            ? <span />
            : <button className="icon-btn" aria-label="Next period" onClick={() => step(1)}><ChevronRight size={16} /></button>}
        </div>

        {calendarView === "daily" && (() => {
          const key = isoDate(cursor);
          const info = byDay[key];
          const isToday = key === isoDate(new Date());
          return (
            <div className="day-focus" style={{ background: info ? heatBg(info.pnl, Math.max(1, Math.abs(info.pnl))) : "transparent" }}>
              <div className="day-focus-head">
                <span className="stat-label">{isToday ? "Today" : cursor.toLocaleDateString(undefined, { weekday: "long" })}</span>
                <button type="button" className="btn btn-ghost row-edit-btn" onClick={() => setNoteDate(key)}>
                  <Pencil size={11} /> {dayNotes[key] ? "Edit note" : "Add note"}
                </button>
              </div>
              <div className="day-focus-pnl"><PnlText value={info ? info.pnl : null} /></div>
              <div className="day-focus-sub">
                {info
                  ? <>{info.count} trade{info.count > 1 ? "s" : ""} closed · {fmtDate(cursor)}</>
                  : <>No trades closed on {fmtDate(cursor)}</>}
              </div>
              {dayNotes[key] && <p className="day-focus-note">{dayNotes[key]}</p>}
              {info && <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => onSelectDay(key)}>View these trades</button>}
            </div>
          );
        })()}

        {calendarView === "weekly" && (() => {
          const start = startOfWeek(cursor);
          const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
          return (
            <>
              <div className="calendar-grid calendar-dow">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="calendar-dow-cell">{d}</div>)}</div>
              <div className="calendar-grid">{days.map((d, i) => dayCell(isoDate(d), d.getDate(), i))}</div>
            </>
          );
        })()}

        {(calendarView === "monthly" || calendarView === "custom") && (
          <>
            <div className="calendar-grid calendar-dow">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="calendar-dow-cell">{d}</div>)}</div>
            <div className="calendar-grid">
              {cells.map((d, i) => d === null
                ? <div key={i} className="calendar-cell calendar-cell-empty" />
                : dayCell(isoDate(new Date(year, month, d)), d, i))}
            </div>
          </>
        )}

        {calendarView === "yearly" && (
          <div className="calendar-grid calendar-grid-months">
            {Array.from({ length: 12 }, (_, m) => {
              const key = `${year}-${String(m + 1).padStart(2, "0")}`;
              const info = byMonth[key];
              return (
                <div key={m} className="calendar-cell calendar-cell-month" style={{ background: info ? heatBg(info.pnl, maxMonthAbs) : "transparent" }}>
                  <span className="calendar-daynum">{new Date(year, m, 1).toLocaleDateString(undefined, { month: "short" })}</span>
                  {info && <span className="mono calendar-pnl" style={{ color: info.pnl >= 0 ? "var(--profit)" : "var(--loss)" }}>{fmtCurrency(info.pnl)}</span>}
                  {info && <span className="calendar-count">{info.count} trade{info.count > 1 ? "s" : ""}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {noteDate && <DayNoteModal date={noteDate} value={dayNotes[noteDate] || ""} onSave={(text) => saveDayNote(noteDate, text)} onClose={() => setNoteDate(null)} />}
    </div>
  );
}
function DayNoteModal({ date, value, onSave, onClose }) {
  const [text, setText] = useState(value);
  return (
    <Modal title={`Journal — ${date}`} onClose={onClose}>
      <textarea className="input textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Market conditions, mindset, plan for the day…" autoFocus />
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => { onSave(text); onClose(); }}><Save size={14} /> Save Note</button>
      </div>
    </Modal>
  );
}

/* ============================================================================
   CHARTS
   The Recharts components live in ./Charts and are pulled in lazily, keeping the
   charting library out of the initial bundle. Each is wrapped so callers can go
   on rendering <DailyPnLChart …/> exactly as before, with the Suspense boundary
   and its placeholder handled here rather than at every call site.

   ChartModeToggle stays local: it is plain buttons, renders in a panel header
   outside the chart's Suspense boundary, and pulling it from the lazy module
   would make the toggle wait on Recharts before it could paint.
============================================================================ */
function lazyChart(name, height) {
  const Lazy = lazy(() => import("./Charts").then((m) => ({ default: m[name] })));
  const Wrapped = (props) => (
    <Suspense fallback={<div className="chart-loading" style={{ height }} />}>
      <Lazy {...props} />
    </Suspense>
  );
  Wrapped.displayName = name;
  return Wrapped;
}
const EquityCurveChart = lazyChart("EquityCurveChart", 280);
const DailyPnLChart = lazyChart("DailyPnLChart", 240);
const MonthlyChart = lazyChart("MonthlyChart", 240);
const WinLossPie = lazyChart("WinLossPie", 240);
const LongShortChart = lazyChart("LongShortChart", 240);
const RRDistributionChart = lazyChart("RRDistributionChart", 240);
const HourOfDayChart = lazyChart("HourOfDayChart", 240);
const DayOfWeekChart = lazyChart("DayOfWeekChart", 240);
const DurationHistogramChart = lazyChart("DurationHistogramChart", 240);
const AssetPerformanceChart = lazyChart("AssetPerformanceChart", 240);
const StrategyPerformanceChart = lazyChart("StrategyPerformanceChart", 240);
const PerformanceBarChart = lazyChart("PerformanceBarChart", 240);
const MaeMfeChart = lazyChart("MaeMfeChart", 300);

function ChartModeToggle({ mode, setMode }) {
  return (
    <div className="segmented segmented-tight">
      <button type="button" className={`seg-btn ${mode === "amount" ? "seg-active-plain" : ""}`} onClick={() => setMode("amount")}>Amount</button>
      <button type="button" className={`seg-btn ${mode === "percent" ? "seg-active-plain" : ""}`} onClick={() => setMode("percent")}>Percent</button>
    </div>
  );
}


/* ============================================================================
   PANELS
============================================================================ */
function Panel({ title, right, children, className }) {
  return <div className={`panel ${className || ""}`}><div className="panel-header"><h4>{title}</h4>{right}</div><div className="panel-body">{children}</div></div>;
}

function DashboardPanel({ trades, settings }) {
  const startingBalance = settings.startingBalance;
  // Period keys are recomputed every render but are only cheap string builds.
  // They belong in the deps below so the figures roll over correctly if the app
  // is left open across midnight, rather than pinning to the day it mounted.
  const today = isoDate(new Date());
  const wk = isoWeekKey(new Date());
  const mo = monthKey(new Date());
  const yearKey = new Date().getFullYear();

  // Every figure below walks the whole trade list. Grouped into one memo so a
  // re-render triggered by anything else — a theme change, a modal opening —
  // doesn't recompute the equity curve, drawdown and streaks from scratch.
  const {
    overall, todayPnl, weekPnl, monthPnl, yearlyProfit, points, dailyData,
    balance, maxDD, maxDDPct, streaks, openCount, sharpe, sortino,
  } = useMemo(() => {
    const closed = trades.filter((t) => t.status === "Closed" && t.pnlAmount !== null);
    const sumWhere = (pred) => closed.filter(pred).reduce((s, t) => s + t.pnlAmount, 0);
    const stats = summarize(trades);
    const curve = equityCurve(trades, startingBalance);
    const daily = groupPerformance(closed, (d) => ({ key: isoDate(d), label: fmtDate(d), sortKey: isoDate(d) }), "date").slice(-30);
    return {
      overall: stats,
      todayPnl: sumWhere((t) => isoDate(t.exitDateTime) === today),
      weekPnl: sumWhere((t) => isoWeekKey(t.exitDateTime) === wk),
      monthPnl: sumWhere((t) => monthKey(t.exitDateTime) === mo),
      yearlyProfit: sumWhere((t) => new Date(t.exitDateTime).getFullYear() === yearKey),
      points: curve,
      dailyData: daily,
      balance: startingBalance + stats.net,
      ...maxDrawdown(curve),
      streaks: consecutiveStreaks(trades),
      openCount: trades.filter((t) => t.status === "Open").length,
      ...sharpeSortino(daily.map((d) => d.pnl), startingBalance),
    };
  }, [trades, startingBalance, today, wk, mo, yearKey]);

  const goals = useMemo(() => ({ ...DEFAULT_GOALS, ...(settings.goals || {}) }), [settings.goals]);
  const dailyLossBreach = goals.maxDailyLoss > 0 && todayPnl < 0 && Math.abs(todayPnl) >= goals.maxDailyLoss;
  const goalRows = [
    { label: "Account Balance", value: balance, target: goals.accountBalance, display: fmtCurrency(balance), targetDisplay: fmtCurrency(goals.accountBalance) },
    { label: "Weekly Profit", value: weekPnl, target: goals.weeklyProfit, display: fmtCurrency(weekPnl), targetDisplay: fmtCurrency(goals.weeklyProfit) },
    { label: "Monthly Profit", value: monthPnl, target: goals.monthlyProfit, display: fmtCurrency(monthPnl), targetDisplay: fmtCurrency(goals.monthlyProfit) },
    { label: "Yearly Profit", value: yearlyProfit, target: goals.yearlyProfit, display: fmtCurrency(yearlyProfit), targetDisplay: fmtCurrency(goals.yearlyProfit) },
    { label: "Win Rate", value: overall.winRate || 0, target: goals.winRate, display: fmtPercent(overall.winRate || 0, 1), targetDisplay: fmtPercent(goals.winRate, 1) },
    { label: "Profit Factor", value: Number.isFinite(overall.profitFactor) ? overall.profitFactor : 0, target: goals.profitFactor, display: fmtProfitFactor(overall.profitFactor), targetDisplay: fmtNum(goals.profitFactor) },
    { label: "Average RR", value: overall.avgRR || 0, target: goals.averageRR, display: `${fmtNum(overall.avgRR || 0)}R`, targetDisplay: `${fmtNum(goals.averageRR)}R` },
  ];

  return (
    <div className="stack">
      {dailyLossBreach && (
        <div className="drawdown-banner">
          <AlertTriangle size={16} /> Daily loss limit hit — {fmtCurrency(Math.abs(todayPnl))} lost today (limit {fmtCurrency(goals.maxDailyLoss)}). Consider stepping away.
        </div>
      )}
      <div className="cards-grid">
        <Card label="Account Balance" value={fmtCurrency(balance)} icon={DollarSign} accentColor="var(--accent)" sub={`Starting ${fmtCurrency(settings.startingBalance)}`} />
        <Card label="Total P&L" value={<PnlText value={overall.net} />} icon={overall.net >= 0 ? TrendingUp : TrendingDown} accentColor={overall.net >= 0 ? "var(--profit)" : "var(--loss)"} />
        <Card label="Today's P&L" value={<PnlText value={todayPnl} />} icon={Activity} />
        <Card label="Weekly P&L" value={<PnlText value={weekPnl} />} icon={CalendarDays} />
        <Card label="Monthly P&L" value={<PnlText value={monthPnl} />} icon={CalendarDays} />
        <Card label="Total Trades" value={trades.length} icon={ListChecks} sub={`${openCount} open`} />
        <Card label="Win Rate" value={overall.winRate !== null ? fmtPercent(overall.winRate, 1) : "—"} icon={Target} />
        <Card label="Average RR" value={overall.avgRR !== null ? `${fmtNum(overall.avgRR)}R` : "—"} icon={Percent} />
        <Card label="Profit Factor" value={fmtProfitFactor(overall.profitFactor)} icon={Award} sub={`${fmtCurrency(overall.grossProfit)} ÷ ${fmtCurrency(overall.grossLossAbs)}`} />
        <Card label="Max Drawdown" value={`${fmtCurrency(maxDD)} (${fmtNum(maxDDPct, 1)}%)`} icon={AlertTriangle} accentColor="var(--loss)" />
        <Card label="Win Streak (max)" value={streaks.maxWin} icon={Flame} accentColor="var(--profit)" />
        <Card label="Loss Streak (max)" value={streaks.maxLoss} icon={Snowflake} accentColor="var(--loss)" />
        <Card label="Sharpe Ratio" value={sharpe !== null ? fmtNum(sharpe, 2) : "—"} icon={TrendingUp} sub="Annualized, last 30 days"
          help="Return earned per unit of total volatility, annualized. Treats upside and downside swings alike. Above 1 is generally considered good, above 2 strong." />
        <Card label="Sortino Ratio" value={sortino !== null ? fmtNum(sortino, 2) : "—"} icon={TrendingUp} sub="Downside risk-adjusted"
          help="Like Sharpe, but only counts losing days as risk — upside volatility is not penalised. Usually higher than Sharpe for a profitable strategy." />
      </div>
      <div className="two-col">
        <Panel title="Equity Curve"><EquityCurveChart points={points} /></Panel>
        <Panel title="Daily P&L (last 30 days)"><DailyPnLChart data={dailyData} /></Panel>
      </div>
      <Panel title="Trading Goals" right={<Badge tone="accent">Editable in Settings</Badge>}>
        <div className="goal-grid">
          {goalRows.map((goal) => {
            const pct = goalProgress(goal.value, goal.target);
            return (
              <div key={goal.label} className="goal-row">
                <div className="goal-row-top"><span>{goal.label}</span><span className="mono">{goal.display} / {goal.targetDisplay}</span></div>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                <div className="goal-percent mono">{fmtPercent(pct, 0)} complete</div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function AnalyticsPanel({ trades, chartMode, setChartMode }) {
  // Every figure on this panel derives from `trades` alone. Grouped into one
  // memo so flipping the Amount/Percent toggle re-renders the charts without
  // re-running summarize() once per grade, per strategy and per direction.
  const {
    closed, overall, longStats, shortStats, monthlyData, weeklyData, yearlyData,
    breakeven, gradeStats, strategyStats, pairCount, hasMaeMfe,
  } = useMemo(() => {
    const closedTrades = trades.filter((t) => t.status === "Closed" && t.pnlAmount !== null);
    const gradeMap = {}; GRADES.forEach((g) => (gradeMap[g] = []));
    trades.forEach((t) => { if (gradeMap[t.grade]) gradeMap[t.grade].push(t); });
    const strategyMap = {};
    trades.forEach((t) => { const key = t.strategy?.trim() || "Unspecified"; (strategyMap[key] = strategyMap[key] || []).push(t); });
    return {
      closed: closedTrades,
      overall: summarize(trades),
      longStats: summarize(trades.filter((t) => t.direction === "Long")),
      shortStats: summarize(trades.filter((t) => t.direction === "Short")),
      monthlyData: groupPerformance(closedTrades, (d) => ({ key: monthKey(d), label: monthLabel(d), sortKey: monthKey(d) }), "month"),
      weeklyData: groupPerformance(closedTrades, (d) => ({ key: weekOfMonthKey(d), label: weekOfMonthLabel(d), sortKey: weekOfMonthKey(d) }), "week"),
      yearlyData: groupPerformance(closedTrades, (d) => String(new Date(d).getFullYear()), "year"),
      breakeven: closedTrades.filter((t) => t.result === "breakeven").length,
      gradeStats: GRADES.map((g) => ({ grade: g, count: gradeMap[g].length, s: summarize(gradeMap[g]) })),
      strategyStats: Object.entries(strategyMap)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([name, list]) => ({ name, count: list.length, s: summarize(list) })),
      pairCount: new Set(trades.map((t) => (t.symbol || "").trim() || "Unspecified")).size,
      hasMaeMfe: closedTrades.some((t) => t._mae !== null || t._mfe !== null),
    };
  }, [trades]);

  return (
    <div className="stack">
      <Panel title="Chart Display" right={<ChartModeToggle mode={chartMode} setMode={setChartMode} />}>
        <div className="hint">Charts can show actual P&amp;L amount or average trade P&amp;L percentage. Hover bars for trade count, Profit Factor, and details.</div>
      </Panel>
      <div className="two-col">
        <Panel title="Win vs Loss"><WinLossPie wins={overall.wins} losses={overall.losses} breakeven={breakeven} /></Panel>
        <Panel title="Long vs Short Comparison"><LongShortChart longStats={longStats} shortStats={shortStats} /></Panel>
      </div>
      <div className="two-col">
        <Panel title="Weekly Performance"><PerformanceBarChart data={weeklyData} labelKey="week" mode={chartMode} /></Panel>
        <Panel title="Monthly Performance"><MonthlyChart data={monthlyData} mode={chartMode} /></Panel>
      </div>
      <div className="two-col">
        <Panel title="Yearly Performance"><PerformanceBarChart data={yearlyData} labelKey="year" mode={chartMode} /></Panel>
        <Panel title="RR Distribution"><RRDistributionChart trades={closed} /></Panel>
      </div>
      <div className="two-col">
        <Panel title="Performance by Hour of Day"><HourOfDayChart trades={closed} /></Panel>
        <Panel title="Performance by Day of Week"><DayOfWeekChart trades={closed} /></Panel>
      </div>
      <Panel title="Trade Duration Analysis" right={<Badge tone="neutral">Win vs Loss by hold time</Badge>}><DurationHistogramChart trades={closed} /></Panel>
      {hasMaeMfe && (
        <Panel title="Trade Efficiency — MAE / MFE" right={<Badge tone="accent">Captured vs. best move</Badge>}>
          <div className="hint" style={{ marginBottom: 8 }}>Each dot is a closed trade: how far it ran in your favor (MFE, x-axis) against what you actually banked (P&amp;L, y-axis). The dashed line is a perfect exit — dots below it gave profit back.</div>
          <MaeMfeChart trades={closed} />
        </Panel>
      )}
      <div className="two-col">
        <Panel title="Strategy Performance"><StrategyPerformanceChart trades={trades} mode={chartMode} /></Panel>
        <Panel title="Performance by Asset (top 10)"><AssetPerformanceChart trades={trades} mode={chartMode} /></Panel>
      </div>
      <Panel title="Performance by Pair" right={<Badge tone="neutral">{pairCount} pair{pairCount === 1 ? "" : "s"}</Badge>}><PairPerformancePanel trades={trades} /></Panel>
      <div className="two-col">
        <Panel title="Long vs Short — Detail">
          <div className="mini-compare">
            <MiniStatBlock title="Long" stats={longStats} tone="profit" />
            <MiniStatBlock title="Short" stats={shortStats} tone="gold" />
            <MiniStatBlock title="Combined" stats={overall} tone="accent" />
          </div>
        </Panel>
        <Panel title="Performance by Grade">
          <div className="table-wrap">
            <table className="trades-table compact-table">
              <thead><tr><th>Grade</th><th>Trades</th><th>Win Rate</th><th>Net P&L</th><th>Avg RR</th></tr></thead>
              <tbody>
                {gradeStats.map(({ grade, count, s }) => (
                  <tr key={grade}><td><Badge tone="gold">{grade}</Badge></td><td className="mono">{count}</td><td className="mono">{s.winRate !== null ? fmtPercent(s.winRate, 1) : "—"}</td><td><PnlText value={s.net} /></td><td className="mono">{s.avgRR !== null ? `${fmtNum(s.avgRR)}R` : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <Panel title="Strategy Performance Analysis">
        <div className="table-wrap">
          <table className="trades-table compact-table">
            <thead><tr><th>Strategy</th><th>Trades</th><th>Win Rate</th><th>Net P&L</th><th>Profit Factor</th></tr></thead>
            <tbody>
              {strategyStats.map(({ name, count, s }) => (
                <tr key={name}><td className="cell-strong">{name}</td><td className="mono">{count}</td><td className="mono">{s.winRate !== null ? fmtPercent(s.winRate, 1) : "—"}</td><td><PnlText value={s.net} /></td><td className="mono">{fmtProfitFactor(s.profitFactor)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
function PairPerformancePanel({ trades }) {
  const map = {};
  trades.forEach((t) => {
    const key = (t.symbol || "").trim() || "Unspecified";
    if (!map[key]) map[key] = { marketType: t.marketType, list: [] };
    map[key].list.push(t);
  });
  const entries = Object.entries(map).sort((a, b) => b[1].list.length - a[1].list.length);
  if (entries.length === 0) return <div className="empty-state-sm">No trades logged yet — add a trade to see it broken down by pair here.</div>;
  return (
    <div className="pair-grid">
      {entries.map(([symbol, { marketType, list }]) => <PairCard key={symbol} symbol={symbol} marketType={marketType} list={list} />)}
    </div>
  );
}
function PairCard({ symbol, marketType, list }) {
  const s = summarize(list);
  const toneColor = s.net > 0 ? "var(--profit)" : s.net < 0 ? "var(--loss)" : "var(--accent)";
  return (
    <div className="pair-card" style={{ borderTopColor: toneColor }}>
      <div className="pair-card-head">
        <span className="pair-card-symbol mono" title={symbol}>{symbol}</span>
        <Badge tone="neutral">{marketType || "—"}</Badge>
      </div>
      <div className="mini-row"><span>Trades</span><span className="mono">{list.length}</span></div>
      <div className="mini-row"><span>Wins</span><span className="mono" style={{ color: "var(--profit)" }}>{s.wins}</span></div>
      <div className="mini-row"><span>Losses</span><span className="mono" style={{ color: "var(--loss)" }}>{s.losses}</span></div>
      <div className="mini-row"><span>Win Rate</span><span className="mono">{s.winRate !== null ? fmtPercent(s.winRate, 1) : "—"}</span></div>
      <div className="mini-row"><span>Net P&amp;L</span><PnlText value={s.net} /></div>
      <div className="mini-row"><span>Avg RR</span><span className="mono">{s.avgRR !== null ? `${fmtNum(s.avgRR)}R` : "—"}</span></div>
    </div>
  );
}
function MiniStatBlock({ title, stats, tone }) {
  return (
    <div className={`mini-block mini-block-${tone}`}>
      <h5>{title}</h5>
      <div className="mini-row"><span>Trades</span><span className="mono">{stats.count}</span></div>
      <div className="mini-row"><span>Win Rate</span><span className="mono">{stats.winRate !== null ? fmtPercent(stats.winRate, 1) : "—"}</span></div>
      <div className="mini-row"><span>Net P&L</span><PnlText value={stats.net} /></div>
      <div className="mini-row"><span>Avg RR</span><span className="mono">{stats.avgRR !== null ? `${fmtNum(stats.avgRR)}R` : "—"}</span></div>
      <div className="mini-row"><span>Profit Factor</span><span className="mono">{fmtProfitFactor(stats.profitFactor)}</span></div>
    </div>
  );
}

/* ============================================================================
   REPORTS PANEL — Excel + Word export
============================================================================ */
function ReportsPanel({ allTrades, filteredTrades, filtersActive, settings, onToast, scopeLabel = "" }) {
  const [includeShots, setIncludeShots] = useState(false);
  const [scope, setScope] = useState("all");
  // Which export is mid-flight, so only that button shows a spinner: one of
  // "excel" | "csv" | "word" | "pdf" | "".
  const [busy, setBusy] = useState("");

  // Reports carry the journal's own name when one is set (Settings > About).
  const reportName = settings.journalName?.trim() || APP_NAME;
  // A filter can be active while the toggle still says "all". Only narrow when
  // both hold; otherwise the whole journal is the subject.
  const useFiltered = scope === "filtered" && filtersActive;
  const trades = useFiltered ? filteredTrades : allTrades;
  const scopeSuffix = useFiltered ? "Filtered" : "All";
  const fileStamp = `${isoDate(new Date())}_${scopeSuffix}`;

  const overall = summarize(trades);
  const points = equityCurve(trades, settings.startingBalance);
  const { maxDD, maxDDPct } = maxDrawdown(points);

  // Turn a save-helper result into a toast. Canceling the native dialog is a
  // deliberate no-op — no success and no error.
  const notify = (res, kind) => {
    if (!res || res.canceled) return;
    if (res.ok) onToast?.({ message: `${kind} exported${res.path ? "" : " to your downloads"}`, tone: "profit" });
    else onToast?.({ message: `${kind} export failed${res.error ? `: ${res.error}` : ""}`, tone: "loss" });
  };

  const exportExcel = async () => {
    setBusy("excel");
    try {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const tradeRows = trades.map((t) => ({
      "Trade ID": t.id, Account: t._accountName || "", Symbol: t.symbol, Market: t.marketType, Direction: t.direction, Status: t.status, Grade: t.grade, Strategy: t.strategy,
      "Entry Price": t._entry, "Stop Loss": t._stop, "Take Profit": t._tp, "Exit Price": t._exit,
      "Entry Time": t.entryDateTime, "Exit Time": t.exitDateTime, Duration: t.duration,
      "Position Size": t._entryQty, "Closed Size": t._qty, "Open Size": t._openQty,
      "Entry Fills": t._entryFills, "Exit Fills": t._exitFills,
      Commission: t._commission, Swap: t._swap, Fees: t._fees, "Risk Amount": t._risk,
      "Expected RR": t.expectedRR, "Actual RR": t.actualRR, "P&L Amount": t.pnlAmount, "P&L %": t.pnlPercent, Result: t.result, Notes: t.notes,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tradeRows), "Trade History");

    const balance = settings.startingBalance + overall.net;
    const summaryRows = [
      { Metric: "Report", Value: `${reportName} — Performance Summary (${scopeSuffix.toLowerCase()} trades)` },
      ...(scopeLabel ? [{ Metric: "Account", Value: scopeLabel }] : []),
      { Metric: "Starting Balance", Value: settings.startingBalance },
      { Metric: "Current Balance", Value: balance },
      { Metric: "Total P&L", Value: overall.net },
      { Metric: "Total Trades", Value: trades.length },
      { Metric: "Wins", Value: overall.wins },
      { Metric: "Losses", Value: overall.losses },
      { Metric: "Win Rate %", Value: overall.winRate },
      { Metric: "Average RR", Value: overall.avgRR },
      { Metric: "Profit Factor", Value: fmtProfitFactor(overall.profitFactor) },
      { Metric: "Profit Factor Formula", Value: "Gross Profit ÷ Absolute Gross Loss" },
      { Metric: "Max Drawdown $", Value: maxDD },
      { Metric: "Max Drawdown %", Value: maxDDPct },
      { Metric: "Gross Profit", Value: overall.grossProfit },
      { Metric: "Gross Loss", Value: overall.grossLoss },
      { Metric: "Gross Loss (absolute)", Value: overall.grossLossAbs },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Dashboard Summary");

    const longStats = summarize(trades.filter((t) => t.direction === "Long"));
    const shortStats = summarize(trades.filter((t) => t.direction === "Short"));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Segment: "Long", ...longStats }, { Segment: "Short", ...shortStats }, { Segment: "Combined", ...overall }]), "Statistics");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(points.map((p) => ({ Date: p.date, Balance: p.balance }))), "Equity Curve");

    // Write to a base64 buffer rather than XLSX.writeFile, so the save routes
    // through the native "Save As" dialog on desktop and a download on web.
    const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    const res = await saveBinaryExport(`BrijTradeJournal_Export_${fileStamp}.xlsx`, base64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    notify(res, "Excel workbook");
    } catch (e) {
      console.error("Excel export failed", e);
      onToast?.({ message: "Excel export failed", tone: "loss" });
    } finally {
      setBusy("");
    }
  };

  const exportCSV = async () => {
    setBusy("csv");
    try {
      const res = await saveTextExport(`BrijTradeJournal_Trades_${fileStamp}.csv`, tradesToCSV(trades), "text/csv;charset=utf-8");
      notify(res, "CSV");
    } catch (e) {
      console.error("CSV export failed", e);
      onToast?.({ message: "CSV export failed", tone: "loss" });
    } finally {
      setBusy("");
    }
  };

  // Screenshots for the closed trades, loaded on demand only when the report is
  // set to include them. Keyed by trade id.
  const gatherShots = async () => {
    if (!includeShots) return {};
    const withShots = trades.filter((t) => t.status === "Closed" && (t.screenshotCount || 0) > 0);
    const results = await Promise.all(withShots.map((t) => storage.get(`${SHOTS_PREFIX}${t.id}`, false).catch(() => null)));
    const map = {};
    withShots.forEach((t, i) => { const r = results[i]; if (r?.value) { try { map[t.id] = JSON.parse(r.value).screenshots; } catch { /* unreadable blob — skip */ } } });
    return map;
  };

  // Shared report markup for both the Word (.doc) and PDF exports. Every free-text
  // trade field is escaped — a symbol or screenshot label containing "<" or "&"
  // would otherwise corrupt the document or inject markup. forWord adds the Office
  // namespaces Word wants; the PDF path gets @page sizing instead.
  const buildReportHtml = (forWord, shotsByTrade) => {
    const balance = settings.startingBalance + overall.net;
    const closedTrades = trades.filter((t) => t.status === "Closed");
    const rows = closedTrades.map((t) => `
      <tr><td>${escapeHtml(t.id)}</td><td>${escapeHtml(t.symbol)}</td><td>${escapeHtml(t.marketType)}</td><td>${escapeHtml(t.direction)}</td>
      <td>${fmtDate(t.entryDateTime)}</td><td>${t.exitDateTime ? fmtDate(t.exitDateTime) : "—"}</td>
      <td style="color:${t.pnlAmount >= 0 ? "#0F9D52" : "#D63A50"}">${fmtCurrency(t.pnlAmount)}</td>
      <td>${t.actualRR !== null ? fmtNum(t.actualRR) + "R" : "—"}</td><td>${escapeHtml(t.grade)}</td></tr>`).join("");
    const shotsHtml = includeShots ? closedTrades.filter((t) => shotsByTrade[t.id]?.length).map((t) => `
      <h4>${escapeHtml(t.id)} — ${escapeHtml(t.symbol)}</h4>
      ${shotsByTrade[t.id].map((s) => `<p><em>${escapeHtml(s.stage)}</em><br/><img src="${s.dataUrl}" style="max-width:480px;border:1px solid #ccc;margin:4px 0 12px" /></p>`).join("")}
    `).join("") : "";
    const nsAttrs = forWord ? " xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'" : "";
    const pageCss = forWord ? "" : "@page{size:A4;margin:14mm;} ";
    return `
      <html${nsAttrs}>
      <head><meta charset="utf-8"><title>${escapeHtml(reportName)} — Report</title>
      <style>${pageCss}body{font-family:Calibri,Arial,sans-serif;color:#1a1a1a;} h1{color:#161A22;margin-bottom:0;} h2{border-bottom:2px solid #3E8FFF;padding-bottom:4px;} table{border-collapse:collapse;width:100%;margin:10px 0;} td,th{border:1px solid #ccc;padding:6px 8px;font-size:11px;text-align:left;} th{background:#161A22;color:#fff;} .summary-grid td{font-size:12px;} img{max-width:100%;}</style></head>
      <body>
        <h1>${escapeHtml(reportName)}</h1><p style="color:#888;margin-top:2px">Trading Performance Report${scopeLabel ? ` · ${escapeHtml(scopeLabel)}` : ""} · ${useFiltered ? "Filtered selection" : "All trades"} · Generated ${fmtDateTime(new Date())}</p>
        <h2>Summary</h2>
        <table class="summary-grid">
          <tr><td><b>Starting Balance</b></td><td>${fmtCurrency(settings.startingBalance)}</td><td><b>Current Balance</b></td><td>${fmtCurrency(balance)}</td></tr>
          <tr><td><b>Total P&amp;L</b></td><td>${fmtCurrency(overall.net)}</td><td><b>Total Trades</b></td><td>${trades.length}</td></tr>
          <tr><td><b>Win Rate</b></td><td>${overall.winRate !== null ? fmtPercent(overall.winRate, 1) : "—"}</td><td><b>Average RR</b></td><td>${overall.avgRR !== null ? fmtNum(overall.avgRR) + "R" : "—"}</td></tr>
          <tr><td><b>Profit Factor</b></td><td>${overall.profitFactor !== null ? (Number.isFinite(overall.profitFactor) ? fmtNum(overall.profitFactor) : "∞") : "—"}</td><td><b>Max Drawdown</b></td><td>${fmtCurrency(maxDD)} (${fmtNum(maxDDPct, 1)}%)</td></tr>
        </table>
        <h2>Trade Statistics</h2>
        <table><tr><th>Segment</th><th>Trades</th><th>Win Rate</th><th>Net P&amp;L</th><th>Avg RR</th><th>Profit Factor</th></tr>
          ${["Long", "Short"].map((dir) => { const s = summarize(trades.filter((t) => t.direction === dir)); return `<tr><td>${dir}</td><td>${s.count}</td><td>${s.winRate !== null ? fmtPercent(s.winRate, 1) : "—"}</td><td>${fmtCurrency(s.net)}</td><td>${s.avgRR !== null ? fmtNum(s.avgRR) + "R" : "—"}</td><td>${s.profitFactor !== null ? (Number.isFinite(s.profitFactor) ? fmtNum(s.profitFactor) : "∞") : "—"}</td></tr>`; }).join("")}
        </table>
        <h2>Trade Details</h2>
        <table><tr><th>ID</th><th>Symbol</th><th>Market</th><th>Dir</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>RR</th><th>Grade</th></tr>${rows}</table>
        ${includeShots ? `<h2>Screenshots</h2>${shotsHtml}` : ""}
      </body></html>`;
  };

  const exportWord = async () => {
    setBusy("word");
    try {
      const html = buildReportHtml(true, await gatherShots());
      const res = await saveTextExport(`BrijTradeJournal_Report_${fileStamp}.doc`, "﻿" + html, "application/msword");
      notify(res, "Word report");
    } catch (e) {
      console.error("Word export failed", e);
      onToast?.({ message: "Word export failed", tone: "loss" });
    } finally {
      setBusy("");
    }
  };

  const exportPDF = async () => {
    setBusy("pdf");
    try {
      const html = buildReportHtml(false, await gatherShots());
      if (desktop?.isElectron) {
        notify(await desktop.savePDF(`BrijTradeJournal_Report_${fileStamp}.pdf`, html), "PDF report");
      } else {
        // Web build has no PDF engine — hand the report to the browser's print
        // dialog, where "Save as PDF" is the destination.
        printHtmlViaBrowser(html);
      }
    } catch (e) {
      console.error("PDF export failed", e);
      onToast?.({ message: "PDF export failed", tone: "loss" });
    } finally {
      setBusy("");
    }
  };

  const busyIcon = (kind) => (busy === kind ? <Loader2 size={14} className="spin" /> : <FileDown size={14} />);

  return (
    <div className="stack">
      <Panel title="Export Scope" right={<Badge tone={useFiltered ? "accent" : "neutral"}>{trades.length} trade{trades.length === 1 ? "" : "s"}</Badge>}>
        <div className="segmented segmented-tight" style={{ maxWidth: 420 }}>
          <button type="button" className={`seg-btn ${!useFiltered ? "seg-active-plain" : ""}`} onClick={() => setScope("all")}>
            All Trades ({allTrades.length})
          </button>
          <button type="button" className={`seg-btn ${useFiltered ? "seg-active-plain" : ""}`} onClick={() => setScope("filtered")} disabled={!filtersActive} title={filtersActive ? "" : "No filter is active — set one on the Trades tab"}>
            Current Filter ({filtersActive ? filteredTrades.length : 0})
          </button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          {filtersActive
            ? "Every export below uses the selected scope. \"Current Filter\" matches whatever you set on the Trades tab — date range, asset, strategy, result and so on."
            : "Set a filter on the Trades tab to export just part of your journal — otherwise every report covers all trades."}
        </p>
      </Panel>

      <Panel title="Export Reports">
        <div className="reports-grid">
          <div className="report-card">
            <FileSpreadsheet size={22} style={{ color: "var(--profit)" }} />
            <h5>Excel Workbook (.xlsx)</h5>
            <p>Trade history, dashboard summary, long/short/combined statistics and the equity curve — each on its own sheet.</p>
            <button className="btn btn-primary" onClick={exportExcel} disabled={!!busy}>{busyIcon("excel")} {busy === "excel" ? "Preparing…" : "Export Excel"}</button>
          </div>
          <div className="report-card">
            <Database size={22} style={{ color: "var(--accent-2)" }} />
            <h5>CSV (.csv)</h5>
            <p>Every trade as plain comma-separated rows — open in any spreadsheet or feed into your own analysis. Same columns as the Excel history sheet.</p>
            <button className="btn btn-primary" onClick={exportCSV} disabled={!!busy}>{busyIcon("csv")} {busy === "csv" ? "Preparing…" : "Export CSV"}</button>
          </div>
          <div className="report-card">
            <FileDown size={22} style={{ color: "var(--loss)" }} />
            <h5>PDF Report (.pdf)</h5>
            <p>A print-ready {reportName} report{desktop?.isElectron ? " saved straight to a PDF file" : " opened in your browser's print dialog — choose \"Save as PDF\""}.</p>
            <label className="checkbox-row"><input type="checkbox" checked={includeShots} onChange={(e) => setIncludeShots(e.target.checked)} /> Include screenshots (larger file)</label>
            <button className="btn btn-primary" onClick={exportPDF} disabled={!!busy}>{busyIcon("pdf")} {busy === "pdf" ? "Preparing…" : "Export PDF"}</button>
          </div>
          <div className="report-card">
            <FileText size={22} style={{ color: "var(--accent)" }} />
            <h5>Word Report (.doc)</h5>
            <p>A formatted {reportName} report: summary, statistics tables and full trade details. Opens directly in Microsoft Word.</p>
            <label className="checkbox-row"><input type="checkbox" checked={includeShots} onChange={(e) => setIncludeShots(e.target.checked)} /> Include screenshots (larger file)</label>
            <button className="btn btn-primary" onClick={exportWord} disabled={!!busy}>{busyIcon("word")} {busy === "word" ? "Preparing…" : "Export Word"}</button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================================
   SETTINGS PANEL
============================================================================ */
function SettingsPanel({ settings, setSettings, trades, replaceAllData, theme, setTheme, strategies, setStrategies, onImportTrades, activeAccountId, setActiveAccountId, preferences, setPreferences }) {
  const fileRef = useRef(null);
  const csvRef = useRef(null);
  const [msg, setMsg] = useState("");
  const [showStrategyMgr, setShowStrategyMgr] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteAccount, setDeleteAccount] = useState(null);
  // A CSV whose rows partly match existing trades waits here for the user to
  // choose (import new only / all / cancel); a parsed backup waits here for the
  // replace-everything confirmation. Neither touches the journal until then.
  const [pendingImport, setPendingImport] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [ruleInput, setRuleInput] = useState("");
  const withShots = trades.filter((t) => (t.screenshotCount || 0) > 0).length;
  const goals = { ...DEFAULT_GOALS, ...(settings.goals || {}) };
  const checklistRules = settings.checklistRules?.length ? settings.checklistRules : DEFAULT_CHECKLIST_RULES;
  const setGoal = (key) => (e) => setSettings((s) => ({ ...s, goals: { ...DEFAULT_GOALS, ...(s.goals || {}), [key]: num(e.target.value, 0) || 0 } }));
  const addRule = () => {
    const rule = ruleInput.trim();
    if (!rule) return;
    setSettings((s) => ({ ...s, checklistRules: [...(s.checklistRules?.length ? s.checklistRules : DEFAULT_CHECKLIST_RULES), rule] }));
    setRuleInput("");
  };
  const removeRule = (rule) => setSettings((s) => ({ ...s, checklistRules: (s.checklistRules?.length ? s.checklistRules : DEFAULT_CHECKLIST_RULES).filter((r) => r !== rule) }));

  /* ---- accounts ---- */
  const accounts = settings.accounts?.length ? settings.accounts : DEFAULT_SETTINGS.accounts;
  // What each account is actually worth, for the list below. Trades arrive here
  // already computed and unscoped, which is the point — this panel is the one
  // place that describes every account rather than just the one in view.
  const accountRows = useMemo(() => accounts.map((a) => {
    const own = trades.filter((t) => t.accountId === a.id);
    const stats = summarize(own);
    return { account: a, count: own.length, net: stats.net, balance: (a.startingBalance || 0) + stats.net };
  }), [accounts, trades]);
  const setAccount = (id, key) => (e) => {
    const raw = e.target.value;
    const v = key === "startingBalance" ? (num(raw, 0) || 0) : raw;
    setSettings((s) => ({ ...s, accounts: normalizeAccounts(s.accounts, s.startingBalance).map((a) => (a.id === id ? { ...a, [key]: v } : a)) }));
  };
  const addAccount = () => {
    const account = { id: uid("ACCT"), name: `Account ${accounts.length + 1}`, broker: "", startingBalance: 0 };
    setSettings((s) => ({ ...s, accounts: [...normalizeAccounts(s.accounts, s.startingBalance), account] }));
    setMsg(`Added ${account.name}. Rename it and set its starting balance.`);
  };
  /* Deleting an account never deletes trades — they move to another account, and
     the modal below says which. A journal has to have somewhere to put a trade,
     so the last account can't be removed at all. */
  const removeAccount = (id) => {
    const remaining = accounts.filter((a) => a.id !== id);
    if (!remaining.length) return;
    const gone = accounts.find((a) => a.id === id);
    const moved = trades.filter((t) => t.accountId === id).length;
    if (activeAccountId === id) setActiveAccountId?.("");
    setSettings((s) => ({ ...s, accounts: normalizeAccounts(s.accounts, s.startingBalance).filter((a) => a.id !== id) }));
    setDeleteAccount(null);
    setMsg(moved
      ? `Deleted ${gone?.name}. Its ${moved} trade${moved === 1 ? "" : "s"} moved to ${remaining[0].name}.`
      : `Deleted ${gone?.name}.`);
  };

  // "Skipped" rows are the ones rowsToTrades drops for having no symbol or no
  // entry price — the user deserves to know their statement wasn't fully read,
  // not just how much of it was.
  const importSummary = (count, skipped) =>
    `Imported ${count} trade${count === 1 ? "" : "s"} from CSV.` +
    (skipped ? ` Skipped ${skipped} row${skipped === 1 ? "" : "s"} with no symbol or entry price.` : "");

  const importCsv = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(reader.result);
        const newTrades = rowsToTrades(rows, { accountId: activeAccountId || accounts[0].id });
        if (!newTrades.length) { setMsg("No recognizable trade rows found in that CSV."); return; }
        const skipped = rows.length - newTrades.length;
        // Rows matching an existing trade's symbol + entry time are usually a
        // statement being imported twice. Nothing lands until the user picks.
        const { fresh, duplicates } = partitionDuplicateImports(trades, newTrades);
        if (duplicates.length) { setPendingImport({ all: newTrades, fresh, duplicates, skipped }); return; }
        onImportTrades(newTrades);
        setMsg(importSummary(newTrades.length, skipped));
      } catch (e) { setMsg("Could not read CSV file: " + e.message); }
    };
    reader.readAsText(file);
  };

  const exportBackup = async () => {
    setMsg("Gathering screenshots for backup…");
    const results = await Promise.all(trades.filter((t) => (t.screenshotCount || 0) > 0).map(async (t) => {
      try { const r = await storage.get(`${SHOTS_PREFIX}${t.id}`, false); return [t.id, r?.value ? JSON.parse(r.value).screenshots : []]; } catch { return [t.id, []]; }
    }));
    const shotsMap = Object.fromEntries(results);
    // stripComputed: these are computed trades, and every derived figure on them
    // is recalculated on restore anyway. Writing them would bloat the file with
    // numbers that are ignored on the way back in.
    const tradesWithShots = trades.map((t) => ({ ...stripComputed(t), screenshots: shotsMap[t.id] || [] }));
    // version 3 adds accounts, fill legs and the commission/swap split. Older
    // backups restore fine — mergeSettings and computeTrade both fall back.
    const payload = { app: APP_NAME, settings, strategies, trades: tradesWithShots, exportedAt: new Date().toISOString(), version: 3 };
    // Through the shared export helper like every other file the app writes, so
    // the desktop build gets its native Save As instead of a silent download.
    const res = await saveTextExport(`BrijTradeJournal_Backup_${isoDate(new Date())}.json`, JSON.stringify(payload), "application/json");
    if (res?.canceled) setMsg("");
    else if (res?.ok) setMsg(`Backup saved${res.path ? "" : " to your downloads"}.`);
    else setMsg(`Backup failed${res?.error ? `: ${res.error}` : ""}.`);
  };

  // Parse and validate only — the journal is untouched until the user confirms
  // the replacement in the modal below. Restoring is as destructive as Clear
  // All, and used to happen the instant a file was picked.
  const importBackup = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.trades)) throw new Error("Invalid backup file");
        setPendingRestore(parsed);
      } catch (e) { setMsg("Could not read backup file: " + e.message); }
    };
    reader.readAsText(file);
  };

  return (
    <div className="stack">
      <Panel title="About">
        <div className="about-row">
          <ProfileMark size={42} settings={settings} setSettings={setSettings} />
          <div><div className="about-title">{settings.journalName?.trim() || APP_NAME}</div><div className="hint">{APP_NAME} · Version {APP_VERSION} · Local-first performance analytics for crypto, forex, commodities, stocks &amp; futures traders. Click the avatar to change your profile image.</div></div>
        </div>
        {/* The journal's own name: shown in the sidebar, the window title and on
            report headers. Blank falls back to the app's built-in name. */}
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="Journal name (optional)">
            <input
              className="input" maxLength={40} placeholder={APP_NAME}
              value={settings.journalName || ""}
              onChange={(e) => setSettings((s) => ({ ...s, journalName: e.target.value }))}
            />
          </Field>
          <Field label="Tagline (optional)">
            <input
              className="input" maxLength={60} placeholder={APP_TAGLINE}
              value={settings.journalTagline || ""}
              onChange={(e) => setSettings((s) => ({ ...s, journalTagline: e.target.value }))}
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Accounts" right={<Badge tone="accent"><Wallet size={12} /> {accounts.length} account{accounts.length === 1 ? "" : "s"}</Badge>}>
        <p className="hint" style={{ marginBottom: 12 }}>
          Each account keeps its own starting balance and its own trades. Every figure in the app — balance, P&amp;L, drawdown, the charts — is scoped to the account picked here, or pooled across all of them.
        </p>
        <div className="account-list">
          {accountRows.map(({ account, count, net, balance }) => (
            <div className="account-card" key={account.id}>
              <div className="account-card-grid">
                <Field label="Name"><input className="input" value={account.name} onChange={setAccount(account.id, "name")} /></Field>
                <Field label="Broker / Exchange (optional)"><input className="input" value={account.broker || ""} placeholder="Binance, IC Markets…" onChange={setAccount(account.id, "broker")} /></Field>
                <Field label="Starting Balance ($)"><input className="input mono" type="number" step="any" value={account.startingBalance} onChange={setAccount(account.id, "startingBalance")} /></Field>
              </div>
              <div className="account-card-foot">
                <span className="hint mono">{count} trade{count === 1 ? "" : "s"} · Balance {fmtCurrency(balance)} · <PnlText value={net} /></span>
                <button
                  className="btn btn-danger-ghost" disabled={accounts.length === 1}
                  title={accounts.length === 1 ? "A journal needs at least one account" : `Delete ${account.name}`}
                  onClick={() => setDeleteAccount({ ...account, count })}
                ><Trash2 size={13} /> Delete</button>
              </div>
            </div>
          ))}
        </div>
        <div className="settings-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={addAccount}><Plus size={14} /> Add Account</button>
          {accounts.length > 1 && (
            <label className="account-scope">
              <span className="field-label">Viewing</span>
              <select className="input account-select" value={activeAccountId || ""} onChange={(e) => setActiveAccountId?.(e.target.value)}>
                <option value="">All Accounts</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </Panel>

      <Panel title="Appearance">
        <div className="theme-grid">
          {Object.entries(THEMES).map(([key, meta]) => {
            const Icon = meta.icon;
            return <button key={key} type="button" className={`theme-tile ${theme === key ? "theme-tile-active" : ""}`} onClick={() => setTheme(key)}><Icon size={13} /> {meta.label}</button>;
          })}
        </div>
        {/* Accent override rides every theme. Green/red stay P&L-only, so the
            presets deliberately offer neither. */}
        <div className="accent-row">
          <span className="field-label" style={{ marginRight: 2 }}>Accent</span>
          <button
            type="button" className={`accent-swatch accent-swatch-default ${!preferences.accent ? "accent-swatch-active" : ""}`}
            title="Use the theme's own accent" onClick={() => setPreferences((p) => ({ ...p, accent: "" }))}
          >Theme default</button>
          {ACCENT_PRESETS.map((hex) => (
            <button
              key={hex} type="button" className={`accent-swatch ${preferences.accent === hex ? "accent-swatch-active" : ""}`}
              style={{ background: hex }} title={hex} aria-label={`Accent ${hex}`}
              onClick={() => setPreferences((p) => ({ ...p, accent: hex }))}
            />
          ))}
          <input
            type="color" className="accent-custom" title="Pick a custom accent"
            aria-label="Custom accent colour" value={preferences.accent || "#3e8fff"}
            onChange={(e) => setPreferences((p) => ({ ...p, accent: normalizeAccent(e.target.value) }))}
          />
        </div>
        <div className="accent-row">
          <span className="field-label" style={{ marginRight: 2 }}>Density</span>
          <div className="segmented segmented-tight" style={{ maxWidth: 280 }}>
            <button type="button" className={`seg-btn ${preferences.density !== "compact" ? "seg-active-plain" : ""}`} onClick={() => setPreferences((p) => ({ ...p, density: "comfortable" }))}>Comfortable</button>
            <button type="button" className={`seg-btn ${preferences.density === "compact" ? "seg-active-plain" : ""}`} onClick={() => setPreferences((p) => ({ ...p, density: "compact" }))}>Compact</button>
          </div>
        </div>
      </Panel>

      <Panel title="Trading Goals" right={<Badge tone="accent"><Target size={12} /> Dashboard</Badge>}>
        <div className="form-grid">
          <Field label="Account Balance Goal ($)"><input className="input mono" type="number" step="any" value={goals.accountBalance} onChange={setGoal("accountBalance")} /></Field>
          <Field label="Weekly Profit Goal ($)"><input className="input mono" type="number" step="any" value={goals.weeklyProfit} onChange={setGoal("weeklyProfit")} /></Field>
          <Field label="Monthly Profit Goal ($)"><input className="input mono" type="number" step="any" value={goals.monthlyProfit} onChange={setGoal("monthlyProfit")} /></Field>
          <Field label="Yearly Profit Goal ($)"><input className="input mono" type="number" step="any" value={goals.yearlyProfit} onChange={setGoal("yearlyProfit")} /></Field>
          <Field label="Win Rate Goal (%)"><input className="input mono" type="number" step="any" value={goals.winRate} onChange={setGoal("winRate")} /></Field>
          <Field label="Profit Factor Goal"><input className="input mono" type="number" step="any" value={goals.profitFactor} onChange={setGoal("profitFactor")} /></Field>
          <Field label="Average RR Goal"><input className="input mono" type="number" step="any" value={goals.averageRR} onChange={setGoal("averageRR")} /></Field>
          <Field label="Max Daily Loss Guard ($, 0 = off)"><input className="input mono" type="number" step="any" value={goals.maxDailyLoss} onChange={setGoal("maxDailyLoss")} /></Field>
        </div>
      </Panel>

      <Panel title="Strategies" right={<button className="btn btn-ghost" onClick={() => setShowStrategyMgr(true)}><SettingsIcon size={13} /> Manage</button>}>
        <div className="strategy-chip-row">{strategies.map((s) => <span key={s} className="badge badge-neutral">{s}</span>)}</div>
      </Panel>

      <Panel title="Rule Checklist" right={<Badge tone="accent">Per-trade discipline</Badge>}>
        <div className="tag-input-row" style={{ marginBottom: 10 }}>
          <input className="input" placeholder="Add a rule, e.g. Waited for confirmation" value={ruleInput} onChange={(e) => setRuleInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRule(); } }} />
          <button className="btn btn-ghost" onClick={addRule}><Plus size={13} /> Add</button>
        </div>
        <div className="strategy-chip-row">
          {checklistRules.map((rule) => <span key={rule} className="badge badge-neutral tag-chip">{rule} <button type="button" onClick={() => removeRule(rule)}><X size={10} /></button></span>)}
        </div>
      </Panel>

      <Panel title="Data & Backup" right={<Badge tone="accent"><ShieldCheck size={12} /> Stored locally</Badge>}>
        <p className="hint" style={{ marginBottom: 12 }}>
          Trade records are saved automatically to this application's private, persistent storage — nothing is sent to an external service. Core trade data is split across storage shards and screenshots are stored per-trade, so the journal stays responsive as it grows. {trades.length} trade{trades.length === 1 ? "" : "s"} on file, {withShots} with screenshots attached.
        </p>
        <div className="settings-actions">
          <button className="btn btn-ghost" onClick={exportBackup}><Database size={14} /> Download Backup (.json)</button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={14} /> Restore from Backup</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ""; }} />
          <button className="btn btn-ghost" onClick={() => csvRef.current?.click()}><ListPlus size={14} /> Import Trades (CSV)</button>
          <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { if (e.target.files[0]) importCsv(e.target.files[0]); e.target.value = ""; }} />
        </div>
        <p className="hint" style={{ marginTop: 8 }}>CSV import recognizes common MT4/MT5, Binance and TradingView export column names (Symbol/Pair, Type/Side, Open/Close Price, Open/Close Time, Size/Lots, S/L, T/P, Commission).</p>
        {msg && <div className="form-note">{msg}</div>}
      </Panel>

      <Panel title="Getting Trades In &amp; Out" right={<Badge tone="accent"><ShieldCheck size={12} /> No account needed</Badge>}>
        <p className="hint" style={{ marginBottom: 10 }}>
          {APP_NAME} is local-first and talks to no one: there is no server, no sign-in and nothing to sync to. Your broker's own statement export is the way in — the CSV import above reads MT4/MT5, Binance and TradingView exports directly, including their separate commission and swap columns. Everything out is a real file you own: JSON backup, CSV, Excel, Word and PDF, all from this panel and the Reports tab.
        </p>
      </Panel>

      <Panel title="Danger Zone">
        <button className="btn btn-danger-ghost" onClick={() => setConfirmClear(true)}><Trash2 size={14} /> Clear All Trades</button>
      </Panel>

      {confirmClear && (
        <ConfirmModal
          title="Clear All Trades" danger confirmLabel="Delete Everything"
          message={`This permanently deletes all ${trades.length} trade${trades.length === 1 ? "" : "s"} across every account, and their screenshots. This cannot be undone — download a backup first if you may want this data back.`}
          onConfirm={() => replaceAllData(settings, [], strategies)} onClose={() => setConfirmClear(false)}
        />
      )}
      {deleteAccount && (
        <ConfirmModal
          title={`Delete ${deleteAccount.name}`} danger confirmLabel="Delete Account"
          message={deleteAccount.count
            ? `${deleteAccount.name} has ${deleteAccount.count} trade${deleteAccount.count === 1 ? "" : "s"}. Deleting the account does not delete them — they move to ${accounts.find((a) => a.id !== deleteAccount.id)?.name}. The account's starting balance is removed.`
            : `Delete ${deleteAccount.name}? It has no trades.`}
          onConfirm={() => removeAccount(deleteAccount.id)} onClose={() => setDeleteAccount(null)}
        />
      )}
      {pendingRestore && (
        <ConfirmModal
          title="Restore Backup" danger confirmLabel="Replace Journal"
          message={`Replace the current journal (${trades.length} trade${trades.length === 1 ? "" : "s"}) with this backup (${pendingRestore.trades.length} trade${pendingRestore.trades.length === 1 ? "" : "s"}${pendingRestore.exportedAt ? `, exported ${fmtDate(pendingRestore.exportedAt)}` : ""})? Everything not in the backup — trades, screenshots, settings — is lost. Download a backup of the current journal first if in doubt.`}
          onConfirm={() => { replaceAllData(pendingRestore.settings || settings, pendingRestore.trades, pendingRestore.strategies || strategies); setMsg("Backup restored successfully."); }}
          onClose={() => setPendingRestore(null)}
        />
      )}
      {pendingImport && (
        <Modal title="Possible Duplicate Import" onClose={() => setPendingImport(null)}>
          <p className="confirm-msg">
            {pendingImport.duplicates.length} of {pendingImport.all.length} row{pendingImport.all.length === 1 ? "" : "s"} in this CSV match trades already in the journal (same symbol and entry time) — this looks like a statement being imported twice.
          </p>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setPendingImport(null)}>Cancel</button>
            <button
              className="btn btn-ghost"
              onClick={() => { onImportTrades(pendingImport.all); setMsg(importSummary(pendingImport.all.length, pendingImport.skipped)); setPendingImport(null); }}
            >Import All {pendingImport.all.length}</button>
            {pendingImport.fresh.length > 0 && (
              <button
                className="btn btn-primary"
                onClick={() => { onImportTrades(pendingImport.fresh); setMsg(`${importSummary(pendingImport.fresh.length, pendingImport.skipped)} Left out ${pendingImport.duplicates.length} duplicate${pendingImport.duplicates.length === 1 ? "" : "s"}.`); setPendingImport(null); }}
              >Import {pendingImport.fresh.length} New Only</button>
            )}
          </div>
        </Modal>
      )}
      {showStrategyMgr && <StrategyManager strategies={strategies} setStrategies={setStrategies} onClose={() => setShowStrategyMgr(false)} />}
    </div>
  );
}

/* ============================================================================
   LIVE CLOCK
============================================================================ */
function LiveClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  const dateStr = time.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const hm = time.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return <span className="mono live-clock">{dateStr}, {hm}</span>;
}

/* ============================================================================
   ROOT APP
============================================================================ */
const NAV = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "trades", label: "Trades", icon: ListChecks },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "reports", label: "Reports", icon: FileDown },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

export default function App() {
  const [theme, setTheme] = useState("dark");
  const [trades, setTrades] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [strategies, setStrategies] = useState(DEFAULT_STRATEGIES);
  const [lastDefaults, setLastDefaults] = useState({});
  // Highest trade-id sequence ever issued in this journal. Persisted with meta,
  // so a number is retired for good rather than being freed by deleting the
  // trade that held it — see nextTradeId in lib/trade.js.
  const [tradeSeqHigh, setTradeSeqHigh] = useState(0);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTabState] = useState("dashboard");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [seedTrade, setSeedTrade] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  // Ids awaiting bulk-delete confirmation. Held separately from deleteId so the
  // single-trade and batch confirmations can word themselves differently.
  const [bulkDeleteIds, setBulkDeleteIds] = useState(null);
  // Set when trades could not be read at startup. Persisting is disabled while
  // this is set — see the save effect below.
  const [loadError, setLoadError] = useState(null);
  // Serialised contents of each shard as last written to storage, keyed by shard
  // index. Lets the save effect below skip shards that haven't changed.
  const writtenShardsRef = useRef({});
  const filters = preferences.filters;
  // Stable identity: FiltersBar debounces search through this, and a new function
  // each render would restart that timer on every render.
  const setFilters = useCallback((updater) => setPreferences((p) => ({ ...p, filters: typeof updater === "function" ? updater(p.filters) : updater })), []);

  /* Tab history — the back/forward arrows walk this, browser-style. Kept in
     memory only: restoring a stale history across restarts would let Back lead
     somewhere the user never went this session. `index` points at the current
     entry, so anything after it is the forward path and is discarded the moment
     a new tab is opened from here. */
  const [navHistory, setNavHistory] = useState({ stack: ["dashboard"], index: 0 });
  const canGoBack = navHistory.index > 0;
  const canGoForward = navHistory.index < navHistory.stack.length - 1;
  /* Tab switches ride the View Transitions API when the browser has it — a
     ~140ms crossfade (duration set in APP_CSS) instead of a hard swap. flushSync
     is required: startViewTransition snapshots the DOM after its callback runs,
     so the state updates must have committed by then, not sit in React's queue.
     Skipped entirely under prefers-reduced-motion; the fallback is the plain
     synchronous update the app always did. */
  const withTabTransition = useCallback((apply) => {
    if (typeof document.startViewTransition === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(() => { flushSync(apply); });
    } else {
      apply();
    }
  }, []);
  // Memoized on `tab` (its same-tab check reads it) so the keydown effect
  // below, which now dispatches Ctrl+1..6 through here, re-subscribes only on
  // an actual navigation rather than every render.
  const setTab = useCallback((next) => {
    // Re-selecting the current tab is not a navigation; recording it would make
    // Back appear to do nothing for one press.
    if (next === tab) return;
    withTabTransition(() => {
      setTabState(next);
      setPreferences((p) => ({ ...p, selectedTab: next }));
      setNavHistory((h) => {
        const stack = [...h.stack.slice(0, h.index + 1), next].slice(-NAV_HISTORY_MAX);
        return { stack, index: stack.length - 1 };
      });
    });
  }, [tab, withTabTransition]);
  // Back/forward move through history without rewriting it, so the entry you
  // came from stays reachable in the other direction. Identity changes only when
  // history itself does — i.e. on an actual navigation, not on every render —
  // so the keydown listener below re-subscribes rarely.
  const goHistory = useCallback((delta) => {
    const idx = navHistory.index + delta;
    if (idx < 0 || idx >= navHistory.stack.length) return;
    const next = navHistory.stack[idx];
    withTabTransition(() => {
      setNavHistory({ ...navHistory, index: idx });
      setTabState(next);
      setPreferences((p) => ({ ...p, selectedTab: next }));
    });
  }, [navHistory, withTabTransition]);
  const sidebarCollapsed = !!preferences.sidebarCollapsed;
  const toggleSidebar = useCallback(() => setPreferences((p) => ({ ...p, sidebarCollapsed: !p.sidebarCollapsed })), []);
  const setChartMode = useCallback((next) => setPreferences((p) => ({ ...p, chartMode: next })), []);
  const [dayFilter, setDayFilter] = useState(null);

  // Transient notifications. pushToast returns nothing the callers need; a toast
  // with an actionLabel (e.g. Undo) dwells longer before auto-dismissing.
  const [toasts, setToasts] = useState([]);
  const dismissToast = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const pushToast = useCallback((toast) => {
    const id = uid("TOAST");
    const duration = toast.duration ?? (toast.actionLabel ? 6500 : 3200);
    setToasts((ts) => [...ts, { ...toast, id }]);
    if (duration > 0) setTimeout(() => dismissToast(id), duration);
  }, [dismissToast]);

  // The journal can carry its own name (Settings > About); empty means the
  // built-in one. Read-side trim so a mid-edit value of "  " still falls back.
  const journalName = settings.journalName?.trim() || APP_NAME;
  const journalTagline = settings.journalTagline?.trim() || APP_TAGLINE;
  useEffect(() => { document.title = journalName; }, [journalName]);

  // Apply the persisted UI zoom. Desktop uses Electron's native zoom via IPC
  // (crisper — scales scrollbars and all); the web build falls back to CSS
  // zoom on <body>, which Chromium and Firefox both honour.
  useEffect(() => {
    if (!loaded) return;
    const factor = clampZoom(preferences.zoom);
    if (window.desktopZoom) window.desktopZoom.set(factor);
    else document.body.style.zoom = factor === 1 ? "" : String(factor);
  }, [preferences.zoom, loaded]);

  // Warm the lazy chart chunk once the app is idle. The dashboard pulls it in
  // anyway, but a session restored onto Trades/Calendar/Settings would
  // otherwise pay the ~300kB Recharts download on its first visit to a chart
  // tab. Same "./Charts" specifier as lazyChart(), so Vite reuses the chunk.
  useEffect(() => {
    if (!loaded) return;
    const warm = () => { import("./Charts"); };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(warm, 2000);
    return () => clearTimeout(t);
  }, [loaded]);
  // A focused number input treats the wheel as a value change, so scrolling the
  // page over one silently rewrites a price. Blur instead and let the page scroll.
  useEffect(() => {
    const onWheel = (e) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === "number" && el === e.target) el.blur();
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const metaRes = await storage.get(META_KEY, false);
        if (mounted && metaRes?.value) {
          const meta = JSON.parse(metaRes.value);
          setSettings(mergeSettings(meta.settings));
          setStrategies(meta.strategies?.length ? meta.strategies : DEFAULT_STRATEGIES);
          setLastDefaults(meta.lastDefaults || {});
          // The id high-water mark. Absent in journals written before it was
          // tracked, which is why the shard scan below raises it to the highest
          // id actually on disk — the counter can start late but never go
          // backwards, or a deleted trade's number would be handed out twice.
          if (Number.isFinite(meta.tradeSeq)) setTradeSeqHigh(meta.tradeSeq);
          if (meta.theme) setTheme(meta.theme);
          const prefs = mergePreferences(meta.preferences);
          setPreferences(prefs);
          const restoredTab = prefs.selectedTab || "dashboard";
          setTabState(restoredTab);
          // The restored tab is where this session starts, so it becomes the
          // root of history rather than sitting behind a "dashboard" entry the
          // user never actually visited.
          setNavHistory({ stack: [restoredTab], index: 0 });
        }
      } catch { /* first run */ }
      try {
        const list = await storage.list(SHARD_PREFIX, false);
        const keys = list?.keys || [];
        const results = await Promise.all(keys.map((k) => storage.get(k, false).catch(() => null)));
        let all = [];
        // Seed the write baseline with what's already on disk, so the first save
        // after boot doesn't rewrite every shard just to reproduce it. This also
        // means a shard that failed to load keeps its baseline of null and is
        // left untouched on save, rather than being deleted to match memory.
        const seeded = {};
        keys.forEach((k, i) => {
          const idx = Number(k.slice(SHARD_PREFIX.length));
          if (Number.isInteger(idx) && results[i]?.value) seeded[idx] = results[i].value;
        });
        for (let i = 0; i < SHARD_COUNT; i++) if (!(i in seeded)) seeded[i] = null;
        writtenShardsRef.current = seeded;
        results.forEach((r) => { if (r?.value) { try { all = all.concat(JSON.parse(r.value)); } catch { /* skip a shard that failed to parse rather than losing the rest */ } } });
        if (mounted) {
          setTrades(all);
          // Never issue an id at or below one already on disk, whatever the
          // stored counter says.
          setTradeSeqHigh((s) => all.reduce((m, t) => Math.max(m, tradeSeq(t.id)), s));
        }
      } catch (e) {
        // A failed read must not look like an empty journal. Saving stays off
        // below, because an empty `trades` would otherwise be written back as
        // "no trades" and delete every shard on disk.
        console.error("Could not read trades from storage", e);
        if (mounted) setLoadError(e?.message || String(e));
      }
      if (mounted) setLoaded(true);
    })();
    return () => { mounted = false; };
  }, []);

  // Meta and trades are saved by separate effects on purpose. Preferences churn
  // constantly — every tab switch and calendar step writes them — and folding
  // that into the trade save would rewrite all SHARD_COUNT shards each time, for
  // trade data that never changed.
  useEffect(() => {
    if (!loaded || loadError) return;
    const timeout = setTimeout(async () => {
      try {
        await storage.set(META_KEY, JSON.stringify({ settings: mergeSettings(settings), strategies, lastDefaults, theme, preferences, tradeSeq: tradeSeqHigh }), false);
      } catch (e) { console.error("Settings save failed", e); }
    }, 500);
    return () => clearTimeout(timeout);
  }, [settings, strategies, lastDefaults, theme, preferences, tradeSeqHigh, loaded, loadError]);

  useEffect(() => {
    // Never persist on top of a failed read: `trades` would be empty for the
    // wrong reason, and writing that back deletes every shard on disk.
    if (!loaded || loadError) return;
    const timeout = setTimeout(async () => {
      const groups = {};
      trades.forEach((tr) => { const sh = shardOf(tr.id); (groups[sh] = groups[sh] || []).push(tr); });
      // Only touch shards whose serialised contents actually changed: a single
      // trade edit lands in one shard, so this writes one key instead of all 24.
      const pending = [];
      for (let i = 0; i < SHARD_COUNT; i++) {
        const arr = groups[i];
        const payload = arr?.length ? JSON.stringify(arr) : null;
        if (writtenShardsRef.current[i] !== payload) pending.push({ i, payload });
      }
      if (!pending.length) return;
      try {
        await Promise.all(pending.map(({ i, payload }) => (
          payload !== null ? storage.set(shardKey(i), payload, false) : storage.delete(shardKey(i), false).catch(() => {})
        )));
        // Recorded only once the writes land — if any threw, the baseline stays
        // as it was so the next save retries these shards rather than assuming
        // disk matches memory.
        pending.forEach(({ i, payload }) => { writtenShardsRef.current[i] = payload; });
      } catch (e) { console.error("Trade save failed", e); }
    }, 500);
    return () => clearTimeout(timeout);
  }, [trades, loaded, loadError]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n" && !typing) { e.preventDefault(); setEditing(null); setSeedTrade(null); setShowForm(true); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b" && !typing) { e.preventDefault(); toggleSidebar(); }
      // Command palette. Deliberately not gated on `typing` — Ctrl+K from a
      // search box is still a palette request — but blocked under the trade
      // form, whose unsaved edits the palette's actions could navigate away from.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !showForm) { e.preventDefault(); setShowPalette((s) => !s); }
      // Ctrl+1..6 jumps straight to a tab, browser-style. Gated like Alt+Arrow:
      // switching the page under an open dialog would strand unsaved edits.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing && !showForm && !viewing) {
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= NAV.length) { e.preventDefault(); setTab(NAV[n - 1].key); }
      }
      // UI zoom. Allowed while typing on purpose — Ctrl never inserts a
      // character, and browser zoom works mid-form too. preventDefault stops
      // the web build's native zoom so ours (which persists) is the only one.
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) { e.preventDefault(); setPreferences((p) => ({ ...p, zoom: stepZoom(p.zoom, 1) })); }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") { e.preventDefault(); setPreferences((p) => ({ ...p, zoom: stepZoom(p.zoom, -1) })); }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") { e.preventDefault(); setPreferences((p) => ({ ...p, zoom: 1 })); }
      if (e.key === "?" && !typing) { e.preventDefault(); setShowShortcuts((s) => !s); }
      // Alt+Arrow is the platform convention for history. Gated on a dialog
      // being closed: navigating the page underneath an open form would strand
      // the user's unsaved edits over a tab they can't see.
      if (e.altKey && !typing && !showForm && !viewing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        goHistory(e.key === "ArrowLeft" ? -1 : 1);
      }
      // TradeForm handles its own Escape so it can guard unsaved edits first.
      // The palette closes before anything underneath it, since it is on top.
      if (e.key === "Escape" && !showForm) { if (showPalette) setShowPalette(false); else if (showShortcuts) setShowShortcuts(false); else if (viewing) setViewing(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showForm, viewing, showShortcuts, showPalette, toggleSidebar, goHistory, setTab]);

  /* ---- accounts ----
     Every trade resolves to exactly one account. An id that names no account —
     a trade older than accounts, or one whose account was deleted — resolves to
     the first, so a trade can never drop out of the journal by belonging
     nowhere. The account's name is attached here, once, because the exports and
     the trades table need it and computeTrade has no idea accounts exist. */
  const accounts = settings.accounts?.length ? settings.accounts : DEFAULT_SETTINGS.accounts;
  // The scoped account can vanish underneath the view — deleted in Settings, or
  // gone after restoring a backup written on another machine. Resolving it
  // against the live list on every read, rather than storing it back, means a
  // stale id shows the pooled view instead of scoping to an account that
  // matches no trades and reading as an empty journal.
  const activeAccount = accounts.find((a) => a.id === preferences.activeAccountId) || null;
  const activeAccountId = activeAccount?.id || "";
  const setActiveAccountId = useCallback((id) => setPreferences((p) => ({ ...p, activeAccountId: id })), []);

  const computedTrades = useMemo(
    () => trades.map((t) => {
      const c = computeTrade(t);
      const acct = accounts.find((a) => a.id === c.accountId) || accounts[0];
      return { ...c, accountId: acct.id, _accountName: acct.name };
    }),
    [trades, accounts]
  );

  // What the app is looking at: one account, or all of them pooled.
  const scopedTrades = useMemo(
    () => (activeAccountId ? computedTrades.filter((t) => t.accountId === activeAccountId) : computedTrades),
    [computedTrades, activeAccountId]
  );
  // Balances are per account, so the "all accounts" view starts from their sum.
  const startingBalance = useMemo(
    () => (activeAccount ? activeAccount.startingBalance : accounts.reduce((s, a) => s + (a.startingBalance || 0), 0)),
    [activeAccount, accounts]
  );
  // Everything downstream reads settings.startingBalance for the account it is
  // scoped to; handing it a settings whose balance already matches the scope
  // keeps that plumbing out of every panel.
  const scopedSettings = useMemo(() => ({ ...settings, startingBalance }), [settings, startingBalance]);

  const filtered = useMemo(() => {
    const range = dateRangeForPreset(filters.datePreset, new Date(), filters.dateFrom, filters.dateTo);
    return scopedTrades.filter((t) => {
      if (dayFilter && isoDate(t.exitDateTime) !== dayFilter) return false;
      const dateForFilter = t.exitDateTime || t.entryDateTime;
      if ((range.from || range.to) && !dateInRange(dateForFilter, range.from, range.to)) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.asset && t.symbol !== filters.asset) return false;
      if (filters.strategy && t.strategy !== filters.strategy) return false;
      if (filters.marketType && t.marketType !== filters.marketType) return false;
      if (filters.direction && t.direction !== filters.direction) return false;
      if (filters.result && t.result !== filters.result) return false;
      if (filters.rrMin && (t.actualRR === null || t.actualRR < num(filters.rrMin))) return false;
      if (filters.rrMax && (t.actualRR === null || t.actualRR > num(filters.rrMax))) return false;
      if (filters.tag && !(t.tags || []).includes(filters.tag)) return false;
      if (filters.search) { const q = filters.search.toLowerCase(); const hay = `${t.symbol} ${t.strategy} ${t.notes}`.toLowerCase(); if (!hay.includes(q)) return false; }
      return true;
    });
  }, [scopedTrades, filters, dayFilter]);

  // Whether the current view is narrowed at all — drives the Reports panel's
  // "export all vs. export current filter" choice.
  const filtersActive = useMemo(
    () => !!dayFilter || Object.keys(DEFAULT_FILTERS).some((k) => filters[k] !== DEFAULT_FILTERS[k]),
    [filters, dayFilter]
  );

  // Filter options, counts and suggestions all describe the account in view —
  // offering a symbol only ever traded on another account would filter to
  // nothing, and an open-trade badge counting trades you can't see is a lie.
  const assets = useMemo(() => [...new Set(scopedTrades.map((t) => t.symbol).filter(Boolean))].sort(), [scopedTrades]);
  const allTags = useMemo(() => [...new Set(scopedTrades.flatMap((t) => t.tags || []))].sort(), [scopedTrades]);
  const openCount = useMemo(() => scopedTrades.filter((t) => t.status === "Open").length, [scopedTrades]);
  const symbolStats = useMemo(() => {
    const map = {};
    scopedTrades.forEach((t) => {
      const symbol = (t.symbol || "").trim().toUpperCase();
      if (!symbol) return;
      map[symbol] = (map[symbol] || 0) + 1;
    });
    return Object.entries(map).map(([symbol, count]) => ({ symbol, count }));
  }, [scopedTrades]);

  const saveTrade = async (form) => {
    const finalId = editing ? form.id : nextTradeId(trades, tradeSeqHigh);
    const screenshots = form.screenshots || [];
    // stripComputed: the form edits a computed trade, and every derived figure on
    // it is recalculated on read — writing them back would store a stale copy.
    const core = { ...stripComputed(form), id: finalId, screenshotCount: screenshots.length };
    if (!core.accountId || !accounts.some((a) => a.id === core.accountId)) core.accountId = activeAccountId || accounts[0].id;
    delete core.screenshots;
    // Retire the number before the record exists, so an Undo of a later delete
    // can never collide with it.
    setTradeSeqHigh((s) => Math.max(s, tradeSeq(finalId)));
    setTrades((prev) => (editing ? prev.map((t) => (t.id === finalId ? core : t)) : [...prev, core]));
    try {
      const shotsKey = `${SHOTS_PREFIX}${finalId}`;
      if (screenshots.length) await storage.set(shotsKey, JSON.stringify({ screenshots }), false);
      else await storage.delete(shotsKey, false).catch(() => {});
    } catch (e) { console.error("Screenshot save failed", e); }
    setLastDefaults({ symbol: core.symbol, marketType: core.marketType, strategy: core.strategy, riskAmount: core.riskAmount, accountId: core.accountId });
    const wasEditing = !!editing;
    setShowForm(false);
    setEditing(null);
    pushToast({ message: `${wasEditing ? "Updated" : "Saved"} ${core.symbol || finalId}`, tone: "profit" });
  };

  const deleteTrade = (id) => setDeleteId(id);
  const confirmDelete = async (id) => {
    const trade = trades.find((t) => t.id === id);
    if (!trade) return;
    // Capture the screenshots before the storage key is deleted, so Undo can put
    // both the record and its images back exactly as they were.
    let shots = [];
    if ((trade.screenshotCount || 0) > 0) {
      try { const r = await storage.get(`${SHOTS_PREFIX}${id}`, false); shots = r?.value ? JSON.parse(r.value).screenshots : []; }
      catch { /* images unreadable — restore the record without them */ }
    }
    setTrades((prev) => prev.filter((t) => t.id !== id));
    storage.delete(`${SHOTS_PREFIX}${id}`, false).catch(() => {});
    setViewing(null);
    pushToast({
      message: `Deleted ${trade.id}${trade.symbol ? ` (${trade.symbol})` : ""}`,
      tone: "danger",
      actionLabel: "Undo",
      onAction: async () => {
        setTrades((prev) => (prev.some((t) => t.id === trade.id) ? prev : [...prev, trade]));
        if (shots.length) {
          try { await storage.set(`${SHOTS_PREFIX}${trade.id}`, JSON.stringify({ screenshots: shots }), false); }
          catch (e) { console.error("Undo could not restore screenshots", e); }
        }
      },
    });
  };

  // Bulk delete mirrors confirmDelete, but captures every record and its images
  // up front so a single Undo restores the whole batch as it was.
  const confirmBulkDelete = async (ids) => {
    const idSet = new Set(ids);
    const doomed = trades.filter((t) => idSet.has(t.id));
    if (!doomed.length) return;
    const shotsById = {};
    await Promise.all(doomed.map(async (t) => {
      if ((t.screenshotCount || 0) === 0) return;
      try { const r = await storage.get(`${SHOTS_PREFIX}${t.id}`, false); if (r?.value) shotsById[t.id] = JSON.parse(r.value).screenshots; }
      catch { /* images unreadable — restore the record without them */ }
    }));
    setTrades((prev) => prev.filter((t) => !idSet.has(t.id)));
    doomed.forEach((t) => storage.delete(`${SHOTS_PREFIX}${t.id}`, false).catch(() => {}));
    setViewing((v) => (v && idSet.has(v.id) ? null : v));
    pushToast({
      message: `Deleted ${doomed.length} trade${doomed.length > 1 ? "s" : ""}`,
      tone: "danger",
      actionLabel: "Undo",
      onAction: async () => {
        setTrades((prev) => {
          const present = new Set(prev.map((t) => t.id));
          return [...prev, ...doomed.filter((t) => !present.has(t.id))];
        });
        await Promise.all(Object.entries(shotsById).map(([id, shots]) => (
          storage.set(`${SHOTS_PREFIX}${id}`, JSON.stringify({ screenshots: shots }), false)
            .catch((e) => console.error("Undo could not restore screenshots", e))
        )));
      },
    });
  };

  const openEdit = async (t) => {
    setEditing({ ...t, screenshots: [], _loadingShots: (t.screenshotCount || 0) > 0 });
    setShowForm(true);
    if ((t.screenshotCount || 0) > 0) {
      try {
        const res = await storage.get(`${SHOTS_PREFIX}${t.id}`, false);
        const shots = res?.value ? JSON.parse(res.value).screenshots : [];
        setEditing((e) => (e && e.id === t.id ? { ...e, screenshots: shots, _loadingShots: false } : e));
      } catch { setEditing((e) => (e && e.id === t.id ? { ...e, _loadingShots: false } : e)); }
    }
  };
  const openView = async (t) => {
    setViewing({ ...t, screenshots: [], _loadingShots: (t.screenshotCount || 0) > 0 });
    if ((t.screenshotCount || 0) > 0) {
      try {
        const res = await storage.get(`${SHOTS_PREFIX}${t.id}`, false);
        const shots = res?.value ? JSON.parse(res.value).screenshots : [];
        setViewing((v) => (v && v.id === t.id ? { ...v, screenshots: shots, _loadingShots: false } : v));
      } catch { setViewing((v) => (v && v.id === t.id ? { ...v, _loadingShots: false } : v)); }
    }
  };

  const openCopy = (t) => {
    setViewing(null);
    setEditing(null);
    // A copy is the same setup taken again, so it starts open and un-exited.
    // The exit legs have to go with exitPrice: they outrank it in computeTrade,
    // so leaving them would carry the old trade's exit onto the new one.
    setSeedTrade({ ...t, id: "", status: "Open", exitPrice: "", exitDateTime: "", exits: [], screenshots: [], screenshotCount: 0 });
    setShowForm(true);
  };

  const importTrades = (newTrades) => {
    // Imported rows land in the account on screen. With "All Accounts" in view
    // there is no such account, so they go to the first rather than nowhere.
    const targetId = activeAccountId || accounts[0].id;
    // Ids are assigned here rather than inside the setTrades updater: the
    // updater has to be pure (StrictMode invokes it twice) and this walks a
    // counter forward as it goes.
    const running = [...trades];
    let floor = tradeSeqHigh;
    const withIds = newTrades.map((t) => {
      const id = nextTradeId(running, floor);
      floor = tradeSeq(id);
      const core = { ...t, id, accountId: t.accountId || targetId, screenshotCount: 0 };
      delete core.screenshots;
      running.push(core);
      return core;
    });
    setTradeSeqHigh(floor);
    setTrades((prev) => [...prev, ...withIds]);
    const where = accounts.length > 1 ? ` into ${accounts.find((a) => a.id === targetId)?.name}` : "";
    pushToast({ message: `Imported ${newTrades.length} trade${newTrades.length === 1 ? "" : "s"}${where}`, tone: "accent" });
  };

  /* Everything the command palette can do. Order matters for the idle list —
     with no query it shows the first entries as-is, so the everyday ones lead
     and the twelve theme switches only surface once typed for. Trades are not
     built here: the palette derives its own trade items from computedTrades,
     and only once there is a query. */
  const paletteActions = [
    { key: "new-trade", label: "New Trade", hint: "Ctrl+N", icon: PlusCircle, haystack: "new trade add log record entry", run: () => { setEditing(null); setSeedTrade(null); setShowForm(true); } },
    ...NAV.map((n, i) => ({ key: `nav-${n.key}`, label: `Go to ${n.label}`, hint: `Ctrl+${i + 1}`, icon: n.icon, haystack: `go to open ${n.label} tab`, run: () => setTab(n.key) })),
    { key: "toggle-sidebar", label: "Toggle Sidebar", hint: "Ctrl+B", icon: PanelLeftClose, haystack: "toggle collapse expand sidebar rail", run: toggleSidebar },
    { key: "toggle-density", label: "Toggle Compact Density", icon: Layers, haystack: "toggle compact comfortable density spacing rows", run: () => setPreferences((p) => ({ ...p, density: p.density === "compact" ? "comfortable" : "compact" })) },
    { key: "shortcuts", label: "Keyboard Shortcuts", hint: "?", icon: Keyboard, haystack: "keyboard shortcuts help keys", run: () => setShowShortcuts(true) },
    ...Object.entries(THEMES).map(([key, meta]) => ({ key: `theme-${key}`, label: `Theme: ${meta.label}`, icon: meta.icon, haystack: `theme appearance switch colours ${meta.label}`, run: () => setTheme(key) })),
  ];

  // Feeds the ticker, which is on screen for every tab — so this walks the whole
  // journal on any App re-render unless it's held here.
  const overall = useMemo(() => summarize(scopedTrades), [scopedTrades]);
  const balance = startingBalance + overall.net;
  const tickerItems = [
    { label: "BALANCE", value: fmtCurrency(balance), color: "var(--text-primary)" },
    { label: "TOTAL P&L", value: fmtCurrency(overall.net), color: overall.net >= 0 ? "var(--profit)" : "var(--loss)" },
    { label: "WIN RATE", value: overall.winRate !== null ? fmtPercent(overall.winRate, 1) : "—", color: "var(--text-primary)" },
    { label: "TRADES", value: String(scopedTrades.length), color: "var(--text-primary)" },
    { label: "AVG RR", value: overall.avgRR !== null ? `${fmtNum(overall.avgRR)}R` : "—", color: "var(--text-primary)" },
    { label: "PROFIT FACTOR", value: overall.profitFactor !== null ? (Number.isFinite(overall.profitFactor) ? fmtNum(overall.profitFactor) : "∞") : "—", color: "var(--accent-2)" },
    { label: "OPEN", value: String(openCount), color: "var(--accent)" },
  ];

  // Only the token block depends on the active theme; the rest of the sheet is
  // the APP_CSS constant, so a theme switch rebuilds a few hundred bytes rather
  // than the whole stylesheet.
  const themeCss = useMemo(() => {
    const tokens = THEMES[theme]?.tokens || TOKENS_DARK;
    return `.app-root { ${Object.entries(tokens).map(([k, v]) => `${k}: ${v};`).join("")} }`;
  }, [theme]);
  /* Accent override (Settings > Appearance). Injected after themeCss on the
     same selector, so it wins the tie and survives theme switches. --accent-soft
     is re-derived from the hex so tinted fills follow the override too; the
     value is normalizeAccent-guaranteed #rrggbb, so the parse can't misfire. */
  const accentCss = useMemo(() => {
    const hex = preferences.accent;
    if (!hex) return "";
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `.app-root { --accent: ${hex}; --accent-soft: rgba(${r},${g},${b},0.16); }`;
  }, [preferences.accent]);

  // Settings, theme and trades all arrive from storage asynchronously. Rendering
  // the shell before they land shows a zero-balance dashboard in the default
  // theme for a beat, then snaps to the real data — hold until it's ready.
  if (!loaded) {
    return (
      <div className="app-root app-booting">
        <style>{themeCss}</style>
        <style>{BOOT_CSS}</style>
        <Loader2 size={16} className="spin" /> Loading your journal…
      </div>
    );
  }

  // Trades could not be read. Saving is disabled while this is showing, so the
  // journal on disk is left exactly as it is rather than being overwritten by an
  // empty one. Presenting an empty dashboard here would be worse than useless:
  // it would look like the data is gone.
  if (loadError) {
    return (
      <div className="app-root app-booting">
        <style>{themeCss}</style>
        <style>{BOOT_CSS}</style>
        <div className="boot-error">
          <AlertTriangle size={20} style={{ color: "var(--loss)" }} />
          <h3>Your trades could not be loaded</h3>
          <p>Nothing has been changed or deleted — saving is switched off until this is resolved, so your journal on disk is untouched.</p>
          <p className="mono boot-error-detail">{loadError}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}><RotateCcw size={14} /> Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-root ${preferences.density === "compact" ? "density-compact" : ""}`}>
      {/* Two tags on purpose: the static sheet is a constant React never has to
          re-create or diff, while only the small token block re-renders on a
          theme change. */}
      <style>{APP_CSS}</style>
      <style>{themeCss}</style>
      {accentCss && <style>{accentCss}</style>}

      <MobileNav title={journalName} />

      <aside className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} id="app-sidebar">
        <div className="brand"><ProfileMark size={30} settings={settings} setSettings={setSettings} /><div className="brand-labels"><div className="brand-text">{journalName}</div><div className="brand-sub">{journalTagline}</div></div></div>
        {NAV.map((n) => (
          // title/aria-label carry the name when collapsed, where the icon is
          // the only visible affordance.
          <button
            key={n.key} className={`nav-item ${tab === n.key ? "active" : ""}`} title={n.label} aria-label={n.label}
            aria-current={tab === n.key ? "page" : undefined}
            onClick={() => { setTab(n.key); document.getElementById("app-sidebar")?.classList.remove("open"); }}
          >
            <n.icon size={16} />
            <span className="nav-label">{n.label}</span>
            {n.key === "trades" && openCount > 0 && <span className="nav-badge"><Badge tone="accent">{openCount}</Badge></span>}
          </button>
        ))}
        <div className="sidebar-footer">Data stored locally in this app. Ctrl/Cmd+K — command palette · Ctrl/Cmd+N — new trade · Ctrl/Cmd+1–6 — tabs · Alt+← / → — back &amp; forward · ? — all shortcuts.</div>
      </aside>

      <div className="main-col">
        <div className="topbar">
          <div className="topbar-left">
            <button
              className="icon-btn" onClick={toggleSidebar}
              title={`${sidebarCollapsed ? "Expand" : "Collapse"} sidebar (Ctrl/Cmd+B)`}
              aria-label={`${sidebarCollapsed ? "Expand" : "Collapse"} sidebar`} aria-expanded={!sidebarCollapsed} aria-controls="app-sidebar"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <div className="nav-arrows">
              <button className="icon-btn" onClick={() => goHistory(-1)} disabled={!canGoBack} title="Back (Alt+←)" aria-label="Back"><ArrowLeft size={16} /></button>
              <button className="icon-btn" onClick={() => goHistory(1)} disabled={!canGoForward} title="Forward (Alt+→)" aria-label="Forward"><ArrowRight size={16} /></button>
            </div>
            <div>
              <h2>{NAV.find((n) => n.key === tab)?.label}</h2>
              <div className="topbar-sub">
                {tab === "dashboard" && "Your trading performance at a glance"}
                {/* Counts what the filters are narrowing, which is the account
                    in view — "of 12" while scoped to an account holding 3 reads
                    as 9 trades hidden by a filter that isn't set. */}
                {tab === "trades" && `${filtered.length} of ${scopedTrades.length} trades shown`}
                {tab === "analytics" && "Deep-dive into edge, direction, grade and strategy"}
                {tab === "calendar" && "Daily P&L heatmap"}
                {tab === "reports" && "Export professional trading reports"}
                {tab === "settings" && "Account, appearance and backups"}
              </div>
            </div>
          </div>
          <LiveClock />
          {/* Only a switcher once there is something to switch between. A single
              account is just "the journal", and a one-option select is noise. */}
          {accounts.length > 1 && (
            <div className="account-switcher">
              <Wallet size={14} />
              <select
                className="input account-select" value={activeAccountId}
                aria-label="Account" title="Scope the journal to one account"
                onChange={(e) => setActiveAccountId(e.target.value)}
              >
                <option value="">All Accounts</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          <button className="btn btn-primary" onClick={() => { setEditing(null); setSeedTrade(null); setShowForm(true); }}><PlusCircle size={15} /> New Trade</button>
        </div>

        <TickerStrip items={tickerItems} />

        <div className="content-scroll">
          <div className="content-inner">
          {/* The dashboard is the account's headline, not a filtered view: it
              sits directly under a ticker built from scopedTrades, and the two
              reading different numbers for "Total P&L" on one screen looked
              like the journal had emptied itself. Filters belong to the Trades
              tab, and Analytics still honours them on purpose — that panel is
              the deep-dive. Reports lets you pick the scope explicitly. */}
          {/* An account with nothing in it yet gets a way forward, not a page
              of zeroed charts that reads like data loss. The Trades tab keeps
              its FiltersBar when only the *filters* empty the list — that
              emptiness is the filters' own message to deliver. */}
          {tab === "dashboard" && (scopedTrades.length === 0
            ? <EmptyState title="Nothing journalled yet" message="Log your first trade — or import your broker's CSV from Settings — and this dashboard lights up." actionLabel="New Trade" onAction={() => { setEditing(null); setSeedTrade(null); setShowForm(true); }} />
            : <DashboardPanel trades={scopedTrades} settings={scopedSettings} />)}
          {tab === "trades" && (scopedTrades.length === 0 ? (
            <EmptyState title="No trades in this journal yet" message="Every trade you log lands here, sortable and filterable. Start with one, or import your broker's CSV from Settings." actionLabel="New Trade" onAction={() => { setEditing(null); setSeedTrade(null); setShowForm(true); }} />
          ) : (
            <div className="stack">
              <FiltersBar filters={filters} setFilters={setFilters} assets={assets} strategies={strategies} tags={allTags} />
              {dayFilter && (
                <div className="filters-bar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12.5 }}>Showing trades closed on <b className="mono">{dayFilter}</b></span>
                  <button className="btn btn-ghost" onClick={() => setDayFilter(null)}>Clear day filter</button>
                </div>
              )}
              {/* Which account a row belongs to only matters where rows from more
                  than one can appear — i.e. the pooled view. */}
              <TradesTable
                trades={filtered} showAccount={!activeAccountId && accounts.length > 1}
                onView={openView} onEdit={openEdit} onDelete={deleteTrade} onCopy={openCopy} onBulkDelete={setBulkDeleteIds} onToast={pushToast}
                hiddenColumns={preferences.hiddenColumns}
                onToggleColumn={(key) => setPreferences((p) => ({ ...p, hiddenColumns: p.hiddenColumns.includes(key) ? p.hiddenColumns.filter((k) => k !== key) : [...p.hiddenColumns, key] }))}
              />
            </div>
          ))}
          {tab === "analytics" && (filtered.length === 0
            ? <EmptyState icon={BarChart3} title="Nothing to analyse" message={filtersActive ? "The current filters leave no trades to chart — loosen them on the Trades tab." : "Analytics needs at least one trade. Log one and the deep-dive builds itself."} />
            : <AnalyticsPanel trades={filtered} chartMode={preferences.chartMode || "amount"} setChartMode={setChartMode} />)}
          {tab === "calendar" && <PerformanceCalendar trades={scopedTrades} preferences={preferences} setPreferences={setPreferences} onSelectDay={(d) => { setDayFilter(d); setTab("trades"); }} />}
          {tab === "reports" && <ReportsPanel allTrades={scopedTrades} filteredTrades={filtered} filtersActive={filtersActive} settings={scopedSettings} scopeLabel={activeAccount?.name || (accounts.length > 1 ? "All Accounts" : "")} onToast={pushToast} />}
          {tab === "settings" && (
            <SettingsPanel
              settings={settings} setSettings={setSettings} trades={computedTrades} theme={theme} setTheme={setTheme}
              strategies={strategies} setStrategies={setStrategies} onImportTrades={importTrades}
              activeAccountId={activeAccountId} setActiveAccountId={setActiveAccountId}
              preferences={preferences} setPreferences={setPreferences}
              replaceAllData={async (s, t, strat) => {
                // mergeSettings: a restored backup can predate accounts entirely,
                // and everything downstream indexes into settings.accounts.
                setSettings(mergeSettings(s));
                if (strat) setStrategies(strat);
                const shotsById = {};
                const coreTrades = t.map((tr) => {
                  const { screenshots, ...rest } = tr;
                  const core = stripComputed(rest);
                  shotsById[core.id] = screenshots || [];
                  return { ...core, screenshotCount: screenshots?.length || core.screenshotCount || 0 };
                });
                setTrades(coreTrades);
                // Persist each trade's screenshots to their own key so a restored
                // backup's images survive beyond this session, not just in memory.
                await Promise.all(coreTrades.map((tr) => {
                  const key = `${SHOTS_PREFIX}${tr.id}`;
                  const shots = shotsById[tr.id];
                  return shots.length ? storage.set(key, JSON.stringify({ screenshots: shots }), false) : storage.delete(key, false).catch(() => {});
                }));
              }}
            />
          )}
          </div>
        </div>
      </div>

      {showForm && (
        <TradeForm
          initial={editing}
          seed={seedTrade}
          strategies={strategies}
          setStrategies={setStrategies}
          lastDefaults={lastDefaults}
          symbolStats={symbolStats}
          checklistRules={settings.checklistRules}
          accounts={accounts}
          // A new trade belongs to the account being looked at. In the pooled
          // view there isn't one, so it falls back to where the last trade went.
          defaultAccountId={activeAccountId || lastDefaults.accountId || accounts[0].id}
          onClose={() => { setShowForm(false); setEditing(null); setSeedTrade(null); }}
          onSave={saveTrade}
        />
      )}
      {viewing && <TradeDetail trade={viewing} onClose={() => setViewing(null)} onEdit={(t) => { setViewing(null); openEdit(t); }} onDelete={deleteTrade} onCopy={openCopy} />}
      {deleteId && (
        <ConfirmModal
          title="Delete Trade" danger confirmLabel="Delete"
          message={`Delete ${deleteId}${trades.find((t) => t.id === deleteId)?.symbol ? ` (${trades.find((t) => t.id === deleteId).symbol})` : ""} and any screenshots attached to it? You can undo this from the notification straight afterwards.`}
          onConfirm={() => confirmDelete(deleteId)} onClose={() => setDeleteId(null)}
        />
      )}
      {bulkDeleteIds?.length > 0 && (
        <ConfirmModal
          title={`Delete ${bulkDeleteIds.length} Trade${bulkDeleteIds.length > 1 ? "s" : ""}`} danger
          confirmLabel={`Delete ${bulkDeleteIds.length}`}
          message={`Delete ${bulkDeleteIds.length} selected trade${bulkDeleteIds.length > 1 ? "s" : ""} and any screenshots attached to them? You can undo this from the notification straight afterwards.`}
          onConfirm={() => confirmBulkDelete(bulkDeleteIds)} onClose={() => setBulkDeleteIds(null)}
        />
      )}
      {showPalette && (
        <CommandPalette
          actions={paletteActions}
          trades={computedTrades}
          onOpenTrade={(t) => { setShowPalette(false); openView(t); }}
          onClose={() => setShowPalette(false)}
        />
      )}
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
/* Transient bottom-right notifications. Some carry an action (e.g. Undo a
   delete); those get a longer dwell before auto-dismiss, set where they are
   pushed. Dismissing runs the same removal the timer would. */
function ToastHost({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone || "accent"}`} role="status">
          <span className="toast-msg">{t.message}</span>
          {t.actionLabel && (
            <button className="toast-action" onClick={() => { t.onAction?.(); onDismiss(t.id); }}>{t.actionLabel}</button>
          )}
          <button className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(t.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
function KeyboardShortcutsModal({ onClose }) {
  const rows = [
    ["Ctrl / Cmd + K", "Command palette — actions, tabs, themes, trade search"],
    ["Ctrl / Cmd + N", "New trade"],
    ["Ctrl / Cmd + 1 – 6", "Jump to a tab (Dashboard … Settings)"],
    ["Alt + ←", "Back to the previous tab"],
    ["Alt + →", "Forward again"],
    ["Ctrl / Cmd + B", "Collapse / expand the sidebar"],
    ["Ctrl / Cmd + + / −", "Zoom the whole app in / out"],
    ["Ctrl / Cmd + 0", "Reset zoom to 100%"],
    ["?", "Toggle this shortcuts panel"],
    ["Esc", "Close the open modal / dialog"],
    ["Ctrl / Cmd + V (in New Trade)", "Paste a clipboard screenshot"],
    ["Enter (in a form field)", "Move to the next field, or submit"],
    ["J / K or ↓ / ↑ (Trades table)", "Move the row cursor"],
    ["Enter / E / X (on a cursor row)", "View / edit / select the trade"],
  ];
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose}>
      <div className="table-wrap">
        <table className="trades-table compact-table">
          <tbody>{rows.map(([keys, desc]) => <tr key={keys}><td className="mono cell-strong">{keys}</td><td>{desc}</td></tr>)}</tbody>
        </table>
      </div>
    </Modal>
  );
}

/* Ctrl/Cmd+K quick launcher: type to jump to a tab, fire an action, switch
   theme, or pull up any trade by symbol / id / strategy / tag / account.
   Matching and ranking are paletteFilter() in lib/trade.js; this is the shell.
   With no query only the leading actions show — themes and trades surface once
   there is something to match, so the idle list stays short. Trades searched
   are the whole journal, not the scoped account: the palette is a global jump. */
function CommandPalette({ actions, trades, onOpenTrade, onClose }) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);

  // Freeze the page behind the overlay, same as Modal.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const results = useMemo(() => {
    const q = query.trim();
    const actionItems = actions.map((a) => ({ kind: "action", key: a.key, haystack: a.haystack, action: a }));
    if (!q) return actionItems.slice(0, 9);
    const tradeItems = trades.map((t) => ({
      kind: "trade", key: t.id,
      haystack: `${t.id} ${t.symbol} ${t.direction || ""} ${t.status || ""} ${t.marketType || ""} ${t.strategy || ""} ${(t.tags || []).join(" ")} ${t._accountName || ""}`,
      trade: t,
    }));
    return paletteFilter(q, [...actionItems, ...tradeItems], 9);
  }, [query, actions, trades]);

  // Keep the highlighted row visible while arrowing through a scrolled list.
  useEffect(() => { listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const run = (item) => {
    if (!item) return;
    if (item.kind === "trade") onOpenTrade(item.trade);
    else { onClose(); item.action.run(); }
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(results[sel]); }
    // Everything is driven from the input; letting Tab walk out of the overlay
    // would land focus on the page frozen behind it.
    else if (e.key === "Tab") e.preventDefault();
  };

  return (
    <div className="palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette-panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input-row">
          <Search size={15} />
          <input
            className="palette-input" autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setSel(0); }} onKeyDown={onKeyDown}
            placeholder="Type a command, or search trades by symbol, id, strategy, tag…"
            aria-label="Search commands and trades"
          />
          <span className="palette-kbd">Esc</span>
        </div>
        {results.length > 0 ? (
          <div className="palette-list" ref={listRef} role="listbox">
            {results.map((r, i) => (
              <button
                key={r.key} type="button" role="option" aria-selected={i === sel}
                className={`palette-item ${i === sel ? "palette-item-active" : ""}`}
                onMouseEnter={() => setSel(i)} onClick={() => run(r)}
              >
                {r.kind === "action" ? (
                  <>
                    <r.action.icon size={15} />
                    <span className="palette-label">{r.action.label}</span>
                    {r.action.hint && <span className="palette-kbd">{r.action.hint}</span>}
                  </>
                ) : (
                  <>
                    {r.trade.direction === "Short" ? <TrendingDown size={15} /> : <TrendingUp size={15} />}
                    <span className="palette-label">{r.trade.symbol} <span className="palette-sub mono">{r.trade.id}</span></span>
                    {r.trade.status === "Open" ? <span className="palette-sub">Open</span> : <span className="mono" style={{ fontSize: 12 }}><PnlText value={r.trade.pnlAmount} /></span>}
                  </>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="palette-empty">No matches — try a symbol, a trade id, or a command like "theme".</div>
        )}
        <div className="palette-foot">↑↓ navigate · Enter select · Esc close</div>
      </div>
    </div>
  );
}

function MobileNav({ title }) {
  return (
    <div className="mobile-topnav">
      <button className="icon-btn" onClick={() => document.getElementById("app-sidebar")?.classList.toggle("open")}><LayoutDashboard size={16} /></button>
      <strong style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13 }}>{title || APP_NAME}</strong>
    </div>
  );
}
