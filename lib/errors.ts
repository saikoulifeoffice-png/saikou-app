/** DB（RPC）エラーを画面表示用に変換する。DB は 'SAIKOU:<CODE>:<メッセージ>' 形式で送出する */
export interface AppError {
  code: string;
  message: string;
}

const FALLBACK: Record<string, string> = {
  "23505": "同じデータが既に登録されています",
  "23503": "関連するデータが見つかりません",
  "23514": "入力値が制約を満たしていません",
  "22P02": "入力形式が正しくありません",
  "42501": "この操作を行う権限がありません",
  PGRST301: "ログインの有効期限が切れました。再度ログインしてください",
};

export function toAppError(error: unknown): AppError {
  const e = error as { message?: string; code?: string } | null;
  const msg = e?.message ?? String(error);
  const m = /SAIKOU:([A-Z_]+):([\s\S]*)/.exec(msg);
  if (m) return { code: m[1], message: m[2].trim() };
  if (e?.code && FALLBACK[e.code]) return { code: e.code, message: FALLBACK[e.code] };
  return { code: "UNKNOWN", message: "処理に失敗しました。時間をおいて再度お試しください" };
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: AppError; fieldErrors?: Record<string, string[]> };

export function fail(code: string, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}
