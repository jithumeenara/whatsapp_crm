import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { CommentsInbox } from "@/components/social/comments-inbox"

export default async function CommentsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  return <CommentsInbox />
}
