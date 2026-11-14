import { z } from "zod";
import { optionalText, uuidSchema, yen } from "./common";

const decimal2 = (label: string) =>
  z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, `${label}は小数2桁までの数値で入力してください`)
    .refine((v) => Number(v) > 0, `${label}は0より大きい値を入力してください`);

export const goldItemSchema = z.object({
  item_name: optionalText(100),
  grade_code: z.string().min(1, "品位を選択してください").max(10),
  weight_g: decimal2("重量"),
  unit_price: decimal2("相場単価").optional(),
});

export const goldPurchaseSchema = z.object({
  idempotency_key: uuidSchema,
  purchased_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "買取日を入力してください"),
  staff_id: uuidSchema.optional(),
  customer_name: z.string().trim().min(1, "お客様の名前を入力してください").max(100),
  customer_phone: z.string().trim().regex(/^[0-9０-９+\-－ー\s]{0,20}$/, "電話番号は数字とハイフンで入力してください").optional(),
  customer_address: optionalText(300),
  paid_amount: yen("買取金額"),
  note: optionalText(1000),
  items: z.array(goldItemSchema).min(1, "商品を1点以上入力してください").max(100, "1取引の商品は100点までです"),
});
export type GoldPurchaseInput = z.input<typeof goldPurchaseSchema>;

export const goldPricesSchema = z.object({
  price_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付を入力してください"),
  source_name: z.string().trim().min(1, "取得元を入力してください").max(100),
  source_url: z.string().trim().url("URLの形式が正しくありません").max(500).optional().or(z.literal("").transform(() => undefined)),
  fetched_at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "取得日時が不正です"),
  note: optionalText(500),
  prices: z.array(z.object({ grade_code: z.string().min(1).max(10), unit_price: decimal2("相場単価") })).min(1, "相場を1件以上入力してください"),
});
export type GoldPricesInput = z.input<typeof goldPricesSchema>;
