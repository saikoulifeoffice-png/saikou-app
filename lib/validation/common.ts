import { z } from "zod";
import { MAX_YEN } from "@/lib/money";

export const yen = (label = "金額") =>
  z
    .number({ error: `${label}を入力してください` })
    .int(`${label}は整数（円）で入力してください`)
    .min(0, `${label}は0円以上で入力してください`)
    .max(MAX_YEN, `${label}が大きすぎます`);

export const positiveYen = (label = "金額") => yen(label).min(1, `${label}は1円以上で入力してください`);

export const taxCategory = z.enum(["standard_10", "reduced_8", "exempt", "non_taxable", "tax_free_export"]);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}文字以内で入力してください`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const uuidSchema = z.uuid("IDが不正です");

/** datetime-local（JST）または ISO 文字列 */
export const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "日時が不正です");
