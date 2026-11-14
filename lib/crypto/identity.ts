import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * 顧客本人確認情報の暗号化（AES-256-GCM）
 * - 鍵はサーバー環境変数のみに保持（DB には暗号文と鍵バージョンだけを保存）
 * - 形式: base64( iv(12) | authTag(16) | ciphertext )
 */
export interface IdentityPayload {
  address?: string;
  birth_date?: string;
  occupation?: string;
  id_document_type?: string;
  id_document_number?: string;
  note?: string;
}

function loadKeys(): Map<number, Buffer> {
  const raw = process.env.IDENTITY_ENCRYPTION_KEYS ?? "";
  const keys = new Map<number, Buffer>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(":");
    const version = Number(part.slice(0, idx));
    const key = Buffer.from(part.slice(idx + 1), "base64");
    if (!Number.isInteger(version) || version <= 0 || key.length !== 32) {
      throw new Error("IDENTITY_ENCRYPTION_KEYS の形式が不正です（版番号:base64(32バイト)）");
    }
    keys.set(version, key);
  }
  return keys;
}

export function identityEncryptionConfigured(): boolean {
  try {
    const keys = loadKeys();
    return keys.has(Number(process.env.IDENTITY_ENCRYPTION_KEY_VERSION ?? "1"));
  } catch {
    return false;
  }
}

export function encryptIdentity(payload: IdentityPayload): { encrypted_payload: string; key_version: number } {
  const version = Number(process.env.IDENTITY_ENCRYPTION_KEY_VERSION ?? "1");
  const key = loadKeys().get(version);
  if (!key) throw new Error("本人確認情報の暗号化鍵が設定されていません");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { encrypted_payload: Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64"), key_version: version };
}

export function decryptIdentity(encrypted: string, version: number): IdentityPayload {
  const key = loadKeys().get(version);
  if (!key) throw new Error(`暗号化鍵（版 ${version}）が見つかりません`);
  const buf = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const pt = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as IdentityPayload;
}
