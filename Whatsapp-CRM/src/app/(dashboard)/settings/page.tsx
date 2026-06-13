'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  Settings,
  Tag,
  User,
  Palette,
  UsersRound,
  Coins,
  Bot,
  Database,
  Bell,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TagManager } from '@/components/settings/tag-manager';
import { ProfileForm } from '@/components/settings/profile-form';
import { PasswordForm } from '@/components/settings/password-form';
import { SessionsCard } from '@/components/settings/sessions-card';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { MembersTab } from '@/components/settings/members-tab';
import { DealsSettings } from '@/components/settings/deals-settings';
import { AiConfig } from '@/components/settings/ai-config';
import { DatabasePanel } from '@/components/settings/database-panel';
import { NotificationsPanel } from '@/components/settings/notifications-panel';

const TAB_VALUES = [
  'profile',
  'whatsapp',
  'tags',
  'deals',
  'appearance',
  'members',
  'ai',
  'database',
  'notifications',
] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(v: string | null): v is TabValue {
  return !!v && (TAB_VALUES as readonly string[]).includes(v);
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the single source of truth for the active tab — no
  // local state, no sync effect. A previous revision duplicated this
  // into `useState` + a sync effect, which tripped React 19's
  // set-state-in-effect rule and was also redundant.
  const queryTab = searchParams.get('tab');
  const tab: TabValue = isTabValue(queryTab) ? queryTab : 'profile';

  const onChange = (next: TabValue) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your profile, WhatsApp® integration, and account preferences.
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => onChange(v as TabValue)}
        orientation="vertical"
        className="items-start gap-6"
      >
        <TabsList className="w-48 shrink-0 self-start rounded-xl border border-border bg-card p-1.5 h-auto gap-0.5">
          <TabsTrigger
            value="profile"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm data-active:bg-primary/10 data-active:text-primary"
          >
            <User className="size-4 shrink-0" />
            Profile
          </TabsTrigger>
          <TabsTrigger
            value="whatsapp"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm data-active:bg-primary/10 data-active:text-primary"
          >
            <Settings className="size-4 shrink-0" />
            WhatsApp Config
          </TabsTrigger>
          <TabsTrigger
            value="tags"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm data-active:bg-primary/10 data-active:text-primary"
          >
            <Tag className="size-4 shrink-0" />
            Tags
          </TabsTrigger>
          <TabsTrigger
            value="deals"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm data-active:bg-primary/10 data-active:text-primary"
          >
            <Coins className="size-4 shrink-0" />
            Deals
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm data-active:bg-primary/10 data-active:text-primary"
          >
            <Palette className="size-4 shrink-0" />
            Appearance
          </TabsTrigger>
          <TabsTrigger
            value="members"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm data-active:bg-primary/10 data-active:text-primary"
          >
            <UsersRound className="size-4 shrink-0" />
            Members
          </TabsTrigger>
          <TabsTrigger
            value="ai"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm data-active:bg-primary/10 data-active:text-primary"
          >
            <Bot className="size-4 shrink-0" />
            AI Config
          </TabsTrigger>
          <TabsTrigger
            value="database"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm data-active:bg-primary/10 data-active:text-primary"
          >
            <Database className="size-4 shrink-0" />
            Database
          </TabsTrigger>
          <TabsTrigger
            value="notifications"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-sm data-active:bg-primary/10 data-active:text-primary"
          >
            <Bell className="size-4 shrink-0" />
            Notifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-0 space-y-6">
          <ProfileForm />
          <PasswordForm />
          <SessionsCard />
        </TabsContent>

        <TabsContent value="whatsapp" className="mt-0">
          <WhatsAppConfig />
        </TabsContent>

        <TabsContent value="tags" className="mt-0">
          <TagManager />
        </TabsContent>

        <TabsContent value="deals" className="mt-0">
          <DealsSettings />
        </TabsContent>

        <TabsContent value="appearance" className="mt-0">
          <AppearancePanel />
        </TabsContent>

        <TabsContent value="members" className="mt-0">
          <MembersTab />
        </TabsContent>

        <TabsContent value="ai" className="mt-0">
          <AiConfig />
        </TabsContent>

        <TabsContent value="database" className="mt-0">
          <DatabasePanel />
        </TabsContent>

        <TabsContent value="notifications" className="mt-0">
          <NotificationsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
