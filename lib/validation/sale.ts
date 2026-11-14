import { z } from "zod";
import { isoDateTime, optionalText, taxCategory, uuidSchema, yen } from "./common";

export const saleLineSchema = z.object({
  item_id: uuidSchema,
  quantity: z.number().int().min(1, "数量は1以上"),
  revenue_incl: yen("販売金額").optional(),
  tax_category: taxCategory,
});

export const saleExpenseSchema = z.object({
  expense_type: z.enum(["fee", "shipping", "other"]),
  amount_incl: yen("経費"),
  tax_category: taxCategory,
  note: optionalText(500),
});

export const saleSchema = z
  .object({
    idempotency_key: uuidSchema,
    sold_at: isoDateTime,
    sales_staff_id: uuidSchema.optional(),
    channel: z.enum(["store", "dealer", "auction", "ec", "other"]),
    buyer_name: optionalText(200),
    allocation: z.enum(["manual", "cost"]),
    total_revenue_incl: yen("販売合計").optional(),
    lines: z.array(saleLineSchema).min(1, "販売する商品を選択してください").max(200),
    expenses: z.array(saleExpenseSchema).max(20),
    expected_receipt_amount: yen("入金予定額").optional(),
    payment_due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    received_now: z.boolean(),
    payment_method: optionalText(50),
    note: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.allocation === "cost" && v.total_revenue_incl === undefined) {
      ctx.addIssue({ code: "custom", path: ["total_revenue_incl"], message: "販売合計金額を入力してください" });
    }
    if (v.allocation === "manual") {
      v.lines.forEach((l, i) => {
        if (l.revenue_incl === undefined) ctx.addIssue({ code: "custom", path: ["lines", i, "revenue_incl"], message: "販売金額を入力してください" });
      });
    }
    const ids = new Set(v.lines.map((l) => l.item_id));
    if (ids.size !== v.lines.length) ctx.addIssue({ code: "custom", path: ["lines"], message: "同じ商品が重複しています" });
  });

export type SaleInput = z.input<typeof saleSchema>;

export const returnSchema = z.object({
  idempotency_key: uuidSchema,
  original_sale_id: uuidSchema,
  returned_at: isoDateTime,
  lines: z.array(z.object({ sale_item_id: uuidSchema, quantity: z.number().int().min(1) })).min(1, "返品する商品を選択してください"),
  refund_total_incl: yen("返金額").optional(),
  expenses: z.array(saleExpenseSchema).max(10),
  note: optionalText(2000),
});

export const paymentSchema = z.object({
  idempotency_key: uuidSchema,
  sale_id: uuidSchema,
  kind: z.enum(["receipt", "refund"]),
  amount: yen("金額").min(1, "金額は1円以上で入力してください"),
  received_at: isoDateTime,
  method: optionalText(50),
  note: optionalText(500),
});
