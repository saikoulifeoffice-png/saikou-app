"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { toAppError, type ActionResult } from "@/lib/errors";
import { optionalText, uuidSchema, yen } from "@/lib/validation/common";

const splitSchema = z.object({
  item_id: uuidSchema,
  idempotency_key: uuidSchema,
  children: z
    .array(
      z.object({
        name: z.string().trim().min(1, "商品名を入力してください").max(200),
        brand: optionalText(100),
        model_no: optionalText(100),
        serial_no: optionalText(100),
        quantity: z.number().int().min(1),
        cost_incl: yen("原価"),
      }),
    )
    .min(2, "2点以上に分割してください"),
});

export async function splitItem(input: z.input<typeof splitSchema>): Promise<ActionResult<{ children: { id: string; item_no: string }[] }>> {
  await requireProfile();
  const parsed = splitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("split_item", { p: parsed.data });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath(`/items/${parsed.data.item_id}`);
  revalidatePath("/items");
  return { ok: true, data: data as unknown as { children: { id: string; item_no: string }[] } };
}
