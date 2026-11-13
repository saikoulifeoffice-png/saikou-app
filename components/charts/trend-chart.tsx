"use client";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatYen } from "@/lib/money";

/** 売上（棒）と純利益（線）の推移。同じ円単位の1軸のみ（2軸は使わない） */
export interface TrendPoint {
  label: string;
  revenue: number;
  net_profit: number;
}

const REVENUE = "#2f4f88"; // navy-500
const PROFIT = "#b98b26"; // gold-500

function compact(v: number) {
  const a = Math.abs(v);
  if (a >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}億`;
  if (a >= 10_000) return `${Math.round(v / 10_000).toLocaleString("ja-JP")}万`;
  return v.toLocaleString("ja-JP");
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-64 w-full sm:h-72" role="img" aria-label="売上と純利益の推移グラフ（下に表形式データあり）">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="#e6ebf3" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#dde3ee" }} tick={{ fontSize: 11, fill: "#5b6780" }} minTickGap={12} />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#5b6780" }} width={52} />
          <Tooltip
            cursor={{ fill: "rgba(47,79,136,0.06)" }}
            formatter={(v, name) => [formatYen(Number(v)), name === "revenue" ? "売上" : "純利益"]}
            contentStyle={{ borderRadius: 8, border: "1px solid #dde3ee", fontSize: 12 }}
          />
          <Legend formatter={(v) => (v === "revenue" ? "売上" : "純利益")} wrapperStyle={{ fontSize: 12, color: "#0f1b33" }} iconSize={10} />
          <Bar dataKey="revenue" fill={REVENUE} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Line dataKey="net_profit" stroke={PROFIT} strokeWidth={2} dot={{ r: 3, fill: PROFIT, stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 5 }} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
