import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { SplitPeople } from "@/components/leads/split-people"

export default async function SplitPeoplePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  return <SplitPeople />
}
