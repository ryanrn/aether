import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";

export default async function IndexPage() {
  const session = await getSession();
  redirect(session ? "/app" : "/login");
}
