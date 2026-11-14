import { z } from "zod";
import { isoDateTime, optionalText, taxCategory, uuidSchema, yen } from "./common";

export const VERIFICATION_METHODS = [
  "運転免許証",
  "マイナンバーカード（個人番号は記録しない）",
  "パスポート",
  "在留カード",
  "健康保険証",
  "その他",
] as const;

export const purchaseItemSchema = z.object({
  category_id: uuidSchema,
  brand: optionalText(100),
  name: z.string().trim().min(1, "商品名を入力してください").max(200, "200文字以内で入力してください"),
  model_no: optionalText(100),
  serial_no: optionalText(100),
  condition: z.enum(["new", "S", "A", "B", "C", "D", "junk"]),
  quantity: z.number().int().min(1, "数量は1以上").max(100000, "数量が大きすぎます"),
  cost_incl: yen("買取金額"),
  tax_category: taxCategory,
  storage_location: optionalText(100),
  note: optionalText(2000),
});

export const identitySchema = z.object({
  verification_method: z.enum(VERIFICATION_METHODS),
  address: optionalText(300),
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "生年月日が不正です")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  occupation: optionalText(100),
  id_document_number: optionalText(50),
  note: optionalText(500),
});

export const purchaseSchema = z
  .object({
    idempotency_key: uuidSchema,
    purchased_at: isoDateTime,
    staff_id: uuidSchema.optional(),
    customer_id: uuidSchema.optional(),
    customer_phone: optionalText(20),
    customer: z
      .object({
        name: z.string().trim().min(1, "顧客名を入力してください").max(100),
        name_kana: optionalText(100),
        phone: z
          .string()
          .trim()
          .regex(/^[0-9+\-]{0,20}$/, "電話番号は数字とハイフンで入力してください")
          .optional(),
      })
      .optional(),
    method: z.enum(["store", "visit", "delivery", "other"]),
    payment_method: z.enum(["cash", "bank_transfer", "other"]),
    note: optionalText(2000),
    identity: identitySchema.optional(),
    items: z.array(purchaseItemSchema).min(1, "商品を1点以上入力してください").max(200, "1取引の商品は200点までです"),
    total_incl: yen("買取合計"),
  })
  .superRefine((v, ctx) => {
    const sum = v.items.reduce((a, i) => a + i.cost_incl, 0);
    if (sum !== v.total_incl) {
      ctx.addIssue({ code: "custom", path: ["total_incl"], message: "買取合計と商品別金額の合計が一致しません" });
    }
    if (v.identity && !v.customer_id && !v.customer) {
      ctx.addIssue({ code: "custom", path: ["customer"], message: "本人確認記録には顧客情報が必要です" });
    }
    if (v.identity?.id_document_number && v.identity.verification_method.startsWith("マイナンバー")) {
      ctx.addIssue({
        code: "custom",
        path: ["identity", "id_document_number"],
        message: "マイナンバー（個人番号）は記録しないでください",
      });
    }
  });

export type PurchaseInput = z.input<typeof purchaseSchema>;
