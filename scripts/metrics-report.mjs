import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Read-only baseline report (METRICS.md §6). Prints rolling 7-day and 28-day
 * funnel counters, conversion ratios, and the north-star approximation from
 * the `aggregate_events` table. No write access, no admin surface.
 *
 * Usage: npm run metrics:report [database-path]
 * Falls back to DATABASE_PATH, then .data/quiz-platform.sqlite.
 */

const databasePath = process.argv[2] ?? process.env.DATABASE_PATH?.trim() ?? path.join(process.cwd(), ".data", "quiz-platform.sqlite");
if (!existsSync(databasePath)) {
  console.error(`No database found at ${databasePath}. Run the app once or pass a path: npm run metrics:report <sqlite>`);
  process.exit(1);
}

const database = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  const hasTable = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'aggregate_events'").get();
  if (!hasTable) {
    console.error("aggregate_events table not found — the application has not recorded any counters yet.");
    process.exit(1);
  }

  const rows = database.prepare(`
    SELECT event_name, entity_type, entity_id, value, event_day, event_count
    FROM aggregate_events
    ORDER BY event_day DESC, event_name
  `).all();

  // The server stores event_day as the UTC ISO date; windows use the same basis.
  const todayUtc = new Date().toISOString().slice(0, 10);
  const dayOffset = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const windowFrom7 = dayOffset(6);
  const windowFrom28 = dayOffset(27);

  const sum = (predicate, windowFrom) => rows
    .filter((row) => predicate(row) && row.event_day >= windowFrom && row.event_day <= todayUtc)
    .reduce((total, row) => total + row.event_count, 0);

  const byEvent = (eventName) => (row) => row.event_name === eventName;

  const sections = [];
  sections.push(["事件计数（滚动 7 天 / 28 天）", () => {
    const names = [...new Set(rows.map((row) => row.event_name))].sort();
    if (!names.length) return ["（还没有任何计数）"];
    return names.map((name) => {
      const week = sum(byEvent(name), windowFrom7);
      const month = sum(byEvent(name), windowFrom28);
      return `  ${name}: ${week} / ${month}`;
    });
  }]);

  const ratio = (numerator, denominator) => denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : "—";

  sections.push(["漏斗转化（滚动 7 天）", () => {
    const homeViews = sum((row) => row.event_name === "route_view" && row.entity_id === "home", windowFrom7);
    const catalogViews = sum((row) => row.event_name === "route_view" && row.entity_id === "catalog", windowFrom7);
    const detailViews = sum((row) => row.event_name === "route_view" && row.entity_id === "detail", windowFrom7);
    const starts = sum(byEvent("quiz_start"), windowFrom7);
    const completions = sum(byEvent("quiz_complete"), windowFrom7);
    const reads = sum(byEvent("result_read"), windowFrom7);
    return [
      `  发现 → 详情：${ratio(detailViews, homeViews + catalogViews)}（详情 ${detailViews}，首页+目录 ${homeViews + catalogViews}）`,
      `  详情 → 开始：${ratio(starts, detailViews)}（开始 ${starts}）`,
      `  开始 → 完成：${ratio(completions, starts)}（完成 ${completions}）`,
      `  完成 → 读完结果：${ratio(reads, completions)}（读完 ${reads}）`,
    ];
  }]);

  sections.push(["北极星（滚动 28 天）", () => {
    const cohort = sum(byEvent("baseline_cohort"), windowFrom28);
    const returns = sum(byEvent("baseline_return"), windowFrom28);
    const buckets = { "1d": 0, "2-7d": 0, "8-28d": 0 };
    for (const row of rows) {
      if (row.event_name !== "baseline_return" || row.event_day < windowFrom28 || row.event_day > todayUtc) continue;
      const bucket = String(row.value).split(":")[1];
      if (bucket in buckets) buckets[bucket] += row.event_count;
    }
    const northStar = cohort > 0 ? ratio(returns, cohort) : "—";
    return [
      `  有意义回访率 ≈ ${northStar}（回访 ${returns} / 进组 ${cohort}）`,
      `  回访间隔分布：1 天 ${buckets["1d"]} · 2–7 天 ${buckets["2-7d"]} · 8–28 天 ${buckets["8-28d"]}`,
      "  口径：P0 严格版（另一日期又完成一次测评）；比率按设备一次性计数近似",
    ];
  }]);

  sections.push(["完成分段（滚动 28 天，语言:设备:长度）", () => {
    const segments = new Map();
    for (const row of rows) {
      if (row.event_name !== "quiz_complete" || row.event_day < windowFrom28 || row.event_day > todayUtc) continue;
      segments.set(row.value, (segments.get(row.value) ?? 0) + row.event_count);
    }
    if (!segments.size) return ["（还没有完成计数）"];
    return [...segments.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([value, count]) => `  ${value}: ${count}`);
  }]);

  console.log(`基线指标报告 · ${databasePath}`);
  console.log(`数据截至 ${todayUtc}（UTC 日）\n`);
  for (const [title, render] of sections) {
    console.log(`# ${title}`);
    for (const line of render()) console.log(line);
    console.log("");
  }
} finally {
  database.close();
}
