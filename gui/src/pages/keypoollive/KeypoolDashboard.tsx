/**
 * MIT License
 *
 * Copyright (c) 2026 Ronan LE MEILLAT
 */

import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styled from "styled-components";
import { lightGray, vscBackground, vscInputBackground } from "../../components";
import { PageHeader } from "../../components/PageHeader";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useNavigationListener } from "../../hooks/useNavigationListener";

type Period = "hour" | "day" | "week" | "month";

interface KeyUsageStat {
  period: string;
  provider: string;
  keyOwner: string;
  keyHint: string;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
}

interface KeyErrorStat {
  provider: string;
  keyOwner: string;
  keyHint: string;
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  lastErrorCode: number | null;
}

const Th = styled.th`
  padding: 0.5rem;
  text-align: left;
  border: 1px solid ${lightGray};
  white-space: nowrap;
`;

const Tr = styled.tr`
  &:hover {
    background-color: ${vscInputBackground};
  }
  border: 1px solid ${lightGray};
`;

const Td = styled.td`
  padding: 0.5rem;
  border: 1px solid ${lightGray};
  font-variant-numeric: tabular-nums;
`;

const PeriodButton = styled.button<{ $active: boolean }>`
  padding: 0.25rem 0.75rem;
  border: 1px solid ${lightGray};
  background: ${(p) => (p.$active ? lightGray : "transparent")};
  color: inherit;
  cursor: pointer;
  font-size: 0.8rem;
  border-radius: 3px;
`;

const PERIOD_LABELS: Record<Period, string> = {
  hour: "Last hour",
  day: "Last 24h",
  week: "Last 7 days",
  month: "Last 30 days",
};

function exportCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => JSON.stringify(r[h] ?? "")).join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function aggregateByKey(rows: KeyUsageStat[]): KeyUsageStat[] {
  const map = new Map<string, KeyUsageStat>();
  for (const r of rows) {
    const key = `${r.keyOwner}|${r.keyHint}|${r.provider}`;
    const existing = map.get(key);
    if (existing) {
      existing.promptTokens += r.promptTokens;
      existing.completionTokens += r.completionTokens;
      existing.requestCount += r.requestCount;
    } else {
      map.set(key, { ...r, period: "total" });
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      b.promptTokens +
      b.completionTokens -
      (a.promptTokens + a.completionTokens),
  );
}

function buildChartData(rows: KeyUsageStat[]): {
  period: string;
  prompt: number;
  completion: number;
}[] {
  const map = new Map<string, { prompt: number; completion: number }>();
  for (const r of rows) {
    const existing = map.get(r.period) ?? { prompt: 0, completion: 0 };
    existing.prompt += r.promptTokens;
    existing.completion += r.completionTokens;
    map.set(r.period, existing);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({
      period,
      prompt: v.prompt,
      completion: v.completion,
    }));
}

function KeypoolDashboard() {
  useNavigationListener();
  const navigate = useNavigate();
  const ideMessenger = useContext(IdeMessengerContext);

  const [period, setPeriod] = useState<Period>("day");
  const [usageRows, setUsageRows] = useState<KeyUsageStat[]>([]);
  const [errorRows, setErrorRows] = useState<KeyErrorStat[]>([]);

  useEffect(() => {
    ideMessenger
      .request("keypoollive/getUsageStats" as any, { period })
      .then((r: any) => r.status === "success" && setUsageRows(r.content));
    ideMessenger
      .request("keypoollive/getErrorStats" as any, { period })
      .then((r: any) => r.status === "success" && setErrorRows(r.content));
  }, [period]);

  const keyTotals = aggregateByKey(usageRows);
  const chartData = buildChartData(usageRows);

  return (
    <div style={{ backgroundColor: vscBackground, minHeight: "100vh" }}>
      <PageHeader
        title="KeypoolLive — Usage Dashboard"
        onTitleClick={() => navigate(-1)}
        showBorder
      />

      <div className="p-3">
        {/* Period selector */}
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm opacity-70">Period:</span>
          {(["hour", "day", "week", "month"] as Period[]).map((p) => (
            <PeriodButton
              key={p}
              $active={p === period}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </PeriodButton>
          ))}
        </div>

        {/* TOKEN USAGE SECTION */}
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="m-0 text-base font-semibold">Token Usage by Key</h2>
            <button
              onClick={() => exportCsv("keypool-usage.csv", keyTotals as any[])}
              style={{
                background: "none",
                border: `1px solid ${lightGray}`,
                color: "inherit",
                cursor: "pointer",
                padding: "2px 8px",
                fontSize: "0.75rem",
                borderRadius: "3px",
              }}
            >
              Export CSV
            </button>
          </div>

          {/* Bar chart: tokens over time */}
          {chartData.length > 0 && (
            <div className="mb-4">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={chartData}
                  margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={lightGray} />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 10 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 10 }} width={55} />
                  <Tooltip
                    formatter={(v: any) => (v as number).toLocaleString()}
                    contentStyle={{
                      backgroundColor: vscBackground,
                      border: `1px solid ${lightGray}`,
                      fontSize: "0.75rem",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                  <Bar
                    dataKey="prompt"
                    name="Prompt tokens"
                    stackId="a"
                    fill="#4f9cf9"
                  />
                  <Bar
                    dataKey="completion"
                    name="Completion tokens"
                    stackId="a"
                    fill="#f97316"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Summary table per key */}
          <table className="w-full border-collapse text-sm">
            <thead>
              <Tr>
                <Th>Key Owner</Th>
                <Th>Key Hint</Th>
                <Th>Provider</Th>
                <Th>Prompt Tokens</Th>
                <Th>Completion Tokens</Th>
                <Th>Total Tokens</Th>
                <Th>Requests</Th>
              </Tr>
            </thead>
            <tbody>
              {keyTotals.length === 0 ? (
                <Tr>
                  <Td colSpan={7} style={{ textAlign: "center", opacity: 0.5 }}>
                    No usage data for this period
                  </Td>
                </Tr>
              ) : (
                keyTotals.map((r, i) => (
                  <Tr key={i}>
                    <Td>{r.keyOwner}</Td>
                    <Td>
                      <code style={{ fontSize: "0.7rem" }}>{r.keyHint}</code>
                    </Td>
                    <Td>{r.provider}</Td>
                    <Td>{r.promptTokens.toLocaleString()}</Td>
                    <Td>{r.completionTokens.toLocaleString()}</Td>
                    <Td>
                      <strong>
                        {(r.promptTokens + r.completionTokens).toLocaleString()}
                      </strong>
                    </Td>
                    <Td>{r.requestCount.toLocaleString()}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ERROR RATES SECTION */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="m-0 text-base font-semibold">Error Rates by Key</h2>
            <button
              onClick={() =>
                exportCsv("keypool-errors.csv", errorRows as any[])
              }
              style={{
                background: "none",
                border: `1px solid ${lightGray}`,
                color: "inherit",
                cursor: "pointer",
                padding: "2px 8px",
                fontSize: "0.75rem",
                borderRadius: "3px",
              }}
            >
              Export CSV
            </button>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <Tr>
                <Th>Key Owner</Th>
                <Th>Key Hint</Th>
                <Th>Provider</Th>
                <Th>Total Requests</Th>
                <Th>Errors</Th>
                <Th>Error Rate</Th>
                <Th>Last Error Code</Th>
              </Tr>
            </thead>
            <tbody>
              {errorRows.length === 0 ? (
                <Tr>
                  <Td colSpan={7} style={{ textAlign: "center", opacity: 0.5 }}>
                    No data for this period
                  </Td>
                </Tr>
              ) : (
                errorRows.map((r, i) => (
                  <Tr key={i}>
                    <Td>{r.keyOwner}</Td>
                    <Td>
                      <code style={{ fontSize: "0.7rem" }}>{r.keyHint}</code>
                    </Td>
                    <Td>{r.provider}</Td>
                    <Td>{r.totalRequests.toLocaleString()}</Td>
                    <Td
                      style={{
                        color:
                          r.errorCount > 0
                            ? "var(--vscode-terminal-ansiRed, #f48771)"
                            : "inherit",
                      }}
                    >
                      {r.errorCount}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span>{r.errorRate}%</span>
                        <div
                          style={{
                            flex: 1,
                            height: "6px",
                            background: lightGray,
                            borderRadius: "3px",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(r.errorRate, 100)}%`,
                              height: "100%",
                              background:
                                r.errorRate > 20
                                  ? "var(--vscode-terminal-ansiRed, #f48771)"
                                  : r.errorRate > 5
                                    ? "var(--vscode-terminal-ansiYellow, #cca700)"
                                    : "var(--vscode-terminal-ansiGreen, #4ec9b0)",
                              borderRadius: "3px",
                            }}
                          />
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {r.lastErrorCode != null && r.lastErrorCode > 0 ? (
                        <code style={{ fontSize: "0.7rem" }}>
                          {r.lastErrorCode}
                        </code>
                      ) : (
                        "N/A"
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default KeypoolDashboard;
