import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { AetherShellV2 } from "@/components/aether-v2";

export default async function V2AppPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <AetherShellV2 />;
}
