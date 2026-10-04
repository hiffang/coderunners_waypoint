import type { Metadata } from "next";
import { NotBuilt } from "@/components/not-built";

export const metadata: Metadata = { title: "Loader" };

export default function LoaderHome() {
  return <NotBuilt portal="Loader" owner="see src/app/loader/CLAUDE.md" />;
}
