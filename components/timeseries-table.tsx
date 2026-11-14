import { formatYen } from "@/lib/money";

export function TimeseriesTable({ rows }: { rows: { label: string; revenue: number; cost_of_sales: number; direct_expense: number; net_profit: number; sales_count: number; purchase_count: number; purchase_amount: number }[] }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-semibold text-navy-600">表で見る</summary>
      <div className="mt-2 max-h-80 overflow-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="sticky top-0 bg-navy-50 text-muted">
            <tr>{["期間", "売上", "売上原価", "直接費", "純利益", "販売件数", "買取件数", "買取額"].map((h) => <th key={h} className="px-2 py-1.5 text-right first:text-left">{h}</th>)}</tr>
          </thead>
          <tbody className="num divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="px-2 py-1">{r.label}</td>
                <td className="px-2 py-1 text-right">{formatYen(r.revenue)}</td>
                <td className="px-2 py-1 text-right">{formatYen(r.cost_of_sales)}</td>
                <td className="px-2 py-1 text-right">{formatYen(r.direct_expense)}</td>
                <td className="px-2 py-1 text-right">{formatYen(r.net_profit)}</td>
                <td className="px-2 py-1 text-right">{r.sales_count}</td>
                <td className="px-2 py-1 text-right">{r.purchase_count}</td>
                <td className="px-2 py-1 text-right">{formatYen(r.purchase_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
