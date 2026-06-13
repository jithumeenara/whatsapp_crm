import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Bot, Zap, MessageSquare, Users, Truck, Headphones } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateChatbotButton } from "@/components/chatbot/create-chatbot-button";

const TEMPLATES = [
  {
    slug: "welcome_faq",
    name: "Welcome & FAQ",
    description: "Greet visitors and answer common questions with quick-reply buttons.",
    icon: MessageSquare,
    color: "bg-blue-100 text-blue-700",
    tags: ["Starter", "Buttons"],
  },
  {
    slug: "lead_qualifier",
    name: "Lead Qualifier",
    description: "Collect name, company, and intent to score and route leads automatically.",
    icon: Users,
    color: "bg-violet-100 text-violet-700",
    tags: ["CRM", "Input"],
  },
  {
    slug: "order_tracking",
    name: "Order Tracking",
    description: "Let customers look up order status via an API request by order ID.",
    icon: Truck,
    color: "bg-amber-100 text-amber-700",
    tags: ["HTTP", "Variables"],
  },
  {
    slug: "ai_support",
    name: "AI Support Agent",
    description: "Answer questions with an AI reply node powered by your system prompt.",
    icon: Headphones,
    color: "bg-emerald-100 text-emerald-700",
    tags: ["AI", "Advanced"],
  },
];

export default async function ChatbotListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  });

  const chatbots = profile?.account_id
    ? await prisma.flow.findMany({
        where: { account_id: profile.account_id, flow_type: "chatbot" },
        orderBy: { created_at: "desc" },
      })
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Chatbots</h1>
          <p className="text-sm text-muted-foreground">
            Build automated WhatsApp conversations with drag-and-drop.
          </p>
        </div>
        <CreateChatbotButton />
      </div>

      {/* Existing chatbots */}
      {chatbots.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Your chatbots
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {chatbots.map((bot) => (
              <Link key={bot.id} href={`/chatbot/${bot.id}`}>
                <Card className="group h-full cursor-pointer transition-all hover:border-primary/40 hover:shadow-md">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                        <Bot className="h-4.5 w-4.5 text-primary" />
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          bot.status === "active"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px]"
                            : "text-[10px]"
                        }
                      >
                        {bot.status}
                      </Badge>
                    </div>
                    <CardTitle className="mt-2 text-sm">{bot.name}</CardTitle>
                    {bot.description && (
                      <CardDescription className="line-clamp-2 text-xs">
                        {bot.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <p className="text-[11px] text-muted-foreground">
                      Created {new Date(bot.created_at).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Templates */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Start from a template
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((tpl) => {
            const Icon = tpl.icon;
            return (
              <Card key={tpl.slug} className="group cursor-pointer transition-all hover:border-primary/40 hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tpl.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm">{tpl.name}</CardTitle>
                      <CardDescription className="text-xs line-clamp-2 mt-0.5">
                        {tpl.description}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {tpl.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px] h-4 px-1.5">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <CreateChatbotButton templateSlug={tpl.slug} templateName={tpl.name} variant="outline" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Empty state */}
      {chatbots.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-border py-16 text-center">
          <Bot className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <h3 className="mt-4 text-lg font-semibold text-foreground">No chatbots yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a blank chatbot or pick a template above.
          </p>
          <div className="mt-6">
            <CreateChatbotButton size="lg" />
          </div>
        </div>
      )}
    </div>
  );
}
