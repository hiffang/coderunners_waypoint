import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ROLE_HOME } from "@/shared/roles";

export default async function Home() {
  const session = await auth();
  redirect(session?.user ? ROLE_HOME[session.user.role] : "/login");
}
