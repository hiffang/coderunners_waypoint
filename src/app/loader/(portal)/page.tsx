import type { Metadata } from "next";
import { LoaderHome } from "@/features/loader/components/loader-home";

export const metadata: Metadata = { title: "Manifests" };

export default function LoaderHomePage() {
  return <LoaderHome />;
}
