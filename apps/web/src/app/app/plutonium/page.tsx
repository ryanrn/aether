import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { PremiumShowcaseScreen } from "@/components/premium";

export default async function PlutoniumPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <PremiumShowcaseScreen />;
}
