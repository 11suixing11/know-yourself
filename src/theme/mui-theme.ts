import { alpha, createTheme, type Theme } from "@mui/material/styles";
import siteTokens from "./site-tokens.json";

/* Bridge theme for the MUI rewrite: every palette slot is expressed with the
 * site's own tokens (generated into site-tokens.json from tokens.css +
 * refactor.css), so migrated components keep the current look while the
 * interaction layer swaps underneath. The Material default face is off:
 * ripples are disabled globally and buttons never uppercase.
 *
 * CssBaseline is deliberately NOT added — globals.css already provides the
 * base layer, and a second reset would fight the one in place. Revisit when
 * the legacy CSS layers are retired. */

type Mode = "light" | "dark";

export interface SiteThemeTokens {
  paper: string;
  paperStrong: string;
  ink: string;
  night: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  muted: string;
  mutedText: string;
  sheetWash: string;
  sheetSurface: string;
  sheetInk: string;
  blueWash: string;
  danger: string;
  teal: string;
  tealSoft: string;
  signal: string;
  signalInk: string;
  sky: string;
  topicSelf: string;
  topicEmotion: string;
  topicRelationship: string;
  topicLife: string;
  surfaceContrast: string;
  surfaceContrastInk: string;
  line: string;
  softLine: string;
  sheetLine: string;
  accentWash: string;
  meterTrack: string;
  meterRule: string;
  meterFill: string;
  meterNeedle: string;
}

declare module "@mui/material/styles" {
  interface Theme {
    site: SiteThemeTokens;
  }
  interface ThemeOptions {
    site?: SiteThemeTokens;
  }
}

const displayStack = 'var(--font-archivo), "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const bodyStack = '"Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const monoStack = 'var(--font-plex-mono), "Cascadia Code", "SFMono-Regular", Consolas, monospace';

/* MUI has no built-in code variant; components import this for monospace. */
export const fontFamilyCode = monoStack;

function siteTokensFor(mode: Mode): SiteThemeTokens {
  const colors = siteTokens[mode] as Record<string, string>;
  const mix = (name: string) => {
    const spec = (siteTokens.mix as Record<string, { ref: string; pct: number }>)[name];
    return alpha(colors[spec.ref], spec.pct / 100);
  };
  return {
    paper: colors.paper,
    paperStrong: colors["paper-strong"],
    ink: colors.ink,
    night: colors.night,
    accent: colors.accent,
    accentInk: colors["accent-ink"],
    accentSoft: colors["accent-soft"],
    muted: colors.muted,
    mutedText: colors["muted-text"],
    sheetWash: colors["sheet-wash"],
    sheetSurface: colors["sheet-surface"],
    sheetInk: colors["sheet-ink"],
    blueWash: colors["blue-wash"],
    danger: colors.danger,
    teal: colors.teal,
    tealSoft: colors["teal-soft"],
    signal: colors.signal,
    signalInk: colors["signal-ink"],
    sky: colors.sky,
    topicSelf: colors["topic-self"],
    topicEmotion: colors["topic-emotion"],
    topicRelationship: colors["topic-relationship"],
    topicLife: colors["topic-life"],
    surfaceContrast: colors["surface-contrast"],
    surfaceContrastInk: colors["surface-contrast-ink"],
    line: mix("line"),
    softLine: mix("soft-line"),
    sheetLine: mix("sheet-line"),
    accentWash: mix("accent-wash"),
    meterTrack: mix("meter-track"),
    meterRule: mix("meter-rule"),
    meterFill: colors["meter-fill"],
    meterNeedle: colors["meter-needle"],
  };
}

/* Breakpoints mirror the Tailwind scale already in use (sm 640 / lg 1024),
 * not Material's (sm 600 / lg 1200), so migrated responsive behavior matches
 * the utilities it replaces. */
function buildSiteTheme(mode: Mode): Theme {
  const s = siteTokensFor(mode);
  return createTheme({
    palette: {
      mode,
      background: { default: s.paper, paper: s.sheetSurface },
      primary: { main: s.accent, contrastText: s.accentInk },
      secondary: { main: s.teal },
      error: { main: s.danger },
      warning: { main: s.signal, contrastText: s.signalInk },
      info: { main: s.sky },
      success: { main: s.teal },
      text: { primary: s.ink, secondary: s.mutedText, disabled: alpha(s.ink, 0.38) },
      divider: s.line,
      action: {
        active: alpha(s.ink, 0.6),
        hover: alpha(s.ink, 0.04),
        selected: alpha(s.accent, 0.08),
        disabled: alpha(s.ink, 0.26),
        disabledBackground: alpha(s.ink, 0.12),
        focus: alpha(s.accent, 0.12),
      },
    },
    shape: { borderRadius: 14 },
    breakpoints: { values: { xs: 0, sm: 640, md: 768, lg: 1024, xl: 1280 } },
    typography: {
      fontFamily: bodyStack,
      h1: { fontFamily: displayStack, fontWeight: 640, fontSize: "clamp(2.4rem, 6vw, 4.2rem)", lineHeight: 1.1, letterSpacing: "-0.015em" },
      h2: { fontFamily: displayStack, fontWeight: 640, fontSize: "clamp(1.8rem, 3vw, 3rem)", lineHeight: 1.08, letterSpacing: "-0.01em" },
      h3: { fontFamily: displayStack, fontWeight: 640, fontSize: "1.75rem" },
      h4: { fontFamily: displayStack, fontWeight: 640, fontSize: "1.25rem" },
      h5: { fontFamily: displayStack, fontWeight: 640, fontSize: "1rem" },
      h6: { fontFamily: displayStack, fontWeight: 640, fontSize: "0.875rem" },
      body1: { lineHeight: 1.75 },
      body2: { lineHeight: 1.65 },
      button: { textTransform: "none", fontWeight: 700 },
      overline: { letterSpacing: "0.08em", fontWeight: 800 },
    },
    zIndex: { appBar: 40 },
    site: s,
    components: {
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiButton: { defaultProps: { disableElevation: true } },
    },
  });
}

export const lightTheme = buildSiteTheme("light");
export const darkTheme = buildSiteTheme("dark");
