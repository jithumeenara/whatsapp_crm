import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { SocialMediaShell } from "@/components/social/social-media-shell"

export default async function SocialMediaPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  return <SocialMediaShell />
}
