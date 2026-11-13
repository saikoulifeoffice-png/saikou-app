import type { NextConfig } from "next";

// 同一オリジン経由モード: /sb/* を Supabase へ転送（lib/supabase/env.ts 参照）
const supabaseProxyTarget = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").startsWith("/")
  ? process.env.SUPABASE_INTERNAL_URL
  : undefined;

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    if (!supabaseProxyTarget) return [];
    return [{ source: "/sb/:path*", destination: `${supabaseProxyTarget.replace(/\/$/, "")}/:path*` }];
  },
};

export default nextConfig;
