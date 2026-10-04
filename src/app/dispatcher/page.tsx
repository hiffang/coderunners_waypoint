import type { Metadata } from "next";
import { NotBuilt } from "@/components/not-built";

export const metadata: Metadata = { title: "Dispatcher" };

export default function DispatcherHome() {
  return <NotBuilt portal="Dispatcher" owner="see src/app/dispatcher/CLAUDE.md" />;
}
