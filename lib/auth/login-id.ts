/**
 * ログインID対応
 * メールアドレスを持たない従業員は「ログインID」でログインする。内部的には
 * 予約済みドメイン（.invalid: 実在せずメールも配送されない）のアドレスに変換して Supabase Auth に登録する。
 */
export const LOGIN_ID_DOMAIN = "login.saikou.invalid";
export const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

/** 入力（メールアドレス or ログインID）→ 認証用メールアドレス。不正なら null */
export function toAuthEmail(input: string): string | null {
  const v = input.trim().toLowerCase();
  if (v.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
  return LOGIN_ID_RE.test(v) ? `${v}@${LOGIN_ID_DOMAIN}` : null;
}

/** 表示用: ログインIDのアカウントは ID を、それ以外はメールアドレスを返す */
export function displayLoginId(email: string | null | undefined): string {
  if (!email) return "—";
  return email.endsWith(`@${LOGIN_ID_DOMAIN}`) ? email.slice(0, -(LOGIN_ID_DOMAIN.length + 1)) : email;
}

export function isLoginIdAccount(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${LOGIN_ID_DOMAIN}`);
}
