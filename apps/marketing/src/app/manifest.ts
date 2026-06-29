import type { MetadataRoute } from "next";
import { brand } from "@/content/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.name,
    short_name: brand.short,
    description: brand.subline,
    start_url: "/",
    display: "standalone",
    background_color: "#0B1020",
    theme_color: "#0B1020",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
