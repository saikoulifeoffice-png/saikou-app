"use client";
import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";
import { addItemPhoto } from "@/app/(app)/purchases/actions";

/**
 * 商品写真のアップロード
 * 1. ブラウザで長辺2000px・JPEG に圧縮
 * 2. ログインユーザーの権限で非公開バケットへ直接アップロード（Storage ポリシーで認可）
 * 3. DB に写真レコードを登録（RPC 側で権限・パス・実在を検証）
 */
export async function uploadItemPhotos(
  itemId: string,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ uploaded: number; failed: string[] }> {
  const supabase = createClient();
  let uploaded = 0;
  const failed: string[] = [];
  for (const [i, file] of files.entries()) {
    try {
      const compressed = await imageCompression(file, {
        maxWidthOrHeight: 2000,
        maxSizeMB: 1.5,
        fileType: "image/jpeg",
        initialQuality: 0.85,
        useWebWorker: true,
      });
      const path = `items/${itemId}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("item-photos").upload(path, compressed, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (error) throw error;
      const res = await addItemPhoto(itemId, path, "image/jpeg", compressed.size);
      if (!res.ok) throw new Error(res.error.message);
      uploaded++;
    } catch {
      failed.push(file.name);
    }
    onProgress?.(i + 1, files.length);
  }
  return { uploaded, failed };
}
