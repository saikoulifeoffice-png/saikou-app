import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "買取SAIKOU Manager",
    short_name: "SAIKOU",
    description: "買取SAIKOU 業務管理システム",
    start_url: "/home",
    display: "standalone",
    background_color: "#0b1730",
    theme_color: "#0b1730",
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
