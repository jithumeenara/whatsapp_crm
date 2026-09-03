'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, type ComponentType } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  ChartNoAxesCombined,
  Check,
  CircleHelp,
  CircleUserRound,
  IdCard,
  Lightbulb,
  LockKeyhole,
  Mail,
  MessageCircle,
  MessageSquare,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  WhatsAppIcon,
  FacebookIcon,
  InstagramIcon,
} from '@/components/icons/brand-icons';
import { EmbeddedSignupButton } from '@/components/settings/embedded-signup-button';

type ChannelKey =
  | 'whatsapp'
  | 'instagram'
  | 'facebook'
  | 'sms'
  | 'email'
  | 'rcs';
type IconComponent = ComponentType<{ className?: string }>;

const WhatsAppConfig = dynamic(
  () =>
    import('@/components/settings/whatsapp-config').then(
      (m) => m.WhatsAppConfig
    ),
  { ssr: false, loading: () => <PanelLoader /> }
);
const InstagramConfig = dynamic(
  () =>
    import('@/components/settings/instagram-config').then(
      (m) => m.InstagramConfig
    ),
  { ssr: false, loading: () => <PanelLoader /> }
);
const FacebookConfig = dynamic(
  () =>
    import('@/components/settings/facebook-config').then(
      (m) => m.FacebookConfig
    ),
  { ssr: false, loading: () => <PanelLoader /> }
);
const SmsConfig = dynamic(
  () => import('@/components/settings/sms-config').then((m) => m.SmsConfig),
  { ssr: false, loading: () => <PanelLoader /> }
);
const EmailConfig = dynamic(
  () => import('@/components/settings/email-config').then((m) => m.EmailConfig),
  { ssr: false, loading: () => <PanelLoader /> }
);
const RcsConfig = dynamic(
  () => import('@/components/settings/rcs-config').then((m) => m.RcsConfig),
  { ssr: false, loading: () => <PanelLoader /> }
);
const WhatsAppBusinessProfile = dynamic(
  () =>
    import('@/components/settings/whatsapp-business-profile').then(
      (m) => m.WhatsAppBusinessProfile
    ),
  { ssr: false, loading: () => <PanelLoader /> }
);
const FacebookBusinessProfile = dynamic(
  () =>
    import('@/components/settings/facebook-business-profile').then(
      (m) => m.FacebookBusinessProfile
    ),
  { ssr: false, loading: () => <PanelLoader /> }
);
const InstagramBusinessProfile = dynamic(
  () =>
    import('@/components/settings/instagram-business-profile').then(
      (m) => m.InstagramBusinessProfile
    ),
  { ssr: false, loading: () => <PanelLoader /> }
);

const CHANNELS: Record<
  ChannelKey,
  {
    label: string;
    icon: IconComponent;
    accent: string;
    pale: string;
    provider: string;
    description: string;
    hasProfile: boolean;
    Config: ComponentType<{ defaultConnectMethod?: 'quick' | 'manual' }>;
    Profile?: ComponentType;
  }
> = {
  whatsapp: {
    label: 'WhatsApp',
    icon: WhatsAppIcon,
    accent: '#25D366',
    pale: '#EAFBF0',
    provider: 'Facebook',
    description:
      'Connect your WhatsApp Business account to chat with customers and grow your business.',
    hasProfile: true,
    Config: WhatsAppConfig,
    Profile: WhatsAppBusinessProfile,
  },
  instagram: {
    label: 'Instagram',
    icon: InstagramIcon,
    accent: '#D946A6',
    pale: '#FFF0F8',
    provider: 'Facebook',
    description:
      'Reply to Instagram messages from the same team inbox as every customer conversation.',
    hasProfile: true,
    Config: InstagramConfig,
    Profile: InstagramBusinessProfile,
  },
  facebook: {
    label: 'Facebook',
    icon: FacebookIcon,
    accent: '#1877F2',
    pale: '#EDF5FF',
    provider: 'Facebook',
    description:
      'Bring Facebook Page conversations into your shared inbox and keep every response visible.',
    hasProfile: true,
    Config: FacebookConfig,
    Profile: FacebookBusinessProfile,
  },
  sms: {
    label: 'SMS',
    icon: MessageSquare,
    accent: '#0EA5E9',
    pale: '#EEF9FF',
    provider: 'your SMS provider',
    description:
      'Send and receive SMS messages through your preferred business messaging provider.',
    hasProfile: false,
    Config: SmsConfig,
  },
  email: {
    label: 'Email',
    icon: Mail,
    accent: '#F59E0B',
    pale: '#FFF8E8',
    provider: 'SendGrid',
    description:
      'Turn customer email into team conversations with a connected delivery and inbound provider.',
    hasProfile: false,
    Config: EmailConfig,
  },
  rcs: {
    label: 'RCS',
    icon: Radio,
    accent: '#7C5CFC',
    pale: '#F3F0FF',
    provider: 'Twilio',
    description:
      'Deliver rich, branded RCS messages using your connected business messaging service.',
    hasProfile: false,
    Config: RcsConfig,
  },
};
const CHANNEL_KEYS = Object.keys(CHANNELS) as ChannelKey[];

// Each channel's config GET route reports connection status in a
// slightly different shape (confirmed by reading the actual routes,
// not guessed): whatsapp/sms/email/rcs return `{ connected: boolean }`
// directly; facebook/instagram return `{ configured: boolean, status }`
// where status === 'connected'. Used to decide whether switching to a
// channel should open its real settings directly instead of the
// "Connect X" marketing page below — without this, an already-connected
// channel showed that page every time, with no way to tell it was
// already set up short of clicking through it.
async function checkChannelConnected(key: ChannelKey): Promise<boolean> {
  try {
    switch (key) {
      case 'whatsapp': {
        const r = await fetch('/api/whatsapp/config').then((x) => x.json());
        return !!r.connected;
      }
      case 'facebook': {
        const r = await fetch('/api/facebook/config').then((x) => x.json());
        return !!r.configured && r.status === 'connected';
      }
      case 'instagram': {
        const r = await fetch('/api/instagram/config').then((x) => x.json());
        return !!r.configured && r.status === 'connected';
      }
      case 'sms': {
        const r = await fetch('/api/sms/config').then((x) => x.json());
        return !!r.connected;
      }
      case 'email': {
        const r = await fetch('/api/email/config').then((x) => x.json());
        return !!r.connected;
      }
      case 'rcs': {
        const r = await fetch('/api/rcs/config').then((x) => x.json());
        return !!r.connected;
      }
    }
  } catch {
    return false;
  }
}

function PanelLoader() {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#5B6CF9] border-t-transparent" />
    </div>
  );
}

function ConnectionAction({
  channel,
  onConnected,
  onManual,
  onAdvanced,
}: {
  channel: ChannelKey;
  onConnected: () => void;
  onManual: () => void;
  onAdvanced: () => void;
}) {
  if (
    channel === 'whatsapp' ||
    channel === 'instagram' ||
    channel === 'facebook'
  )
    return (
      <div className="flex w-full flex-col gap-2.5 sm:w-auto">
        <EmbeddedSignupButton
          onConnected={onConnected}
          className="h-11 w-full rounded-xl bg-[#5B5CF6] px-5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(91,92,246,0.22)] hover:bg-[#4949E8] sm:w-auto"
        />
        {/* Goes straight to the real manual credential form (via
            defaultConnectMethod="manual") — this used to land on
            WhatsAppConfig/FacebookConfig/InstagramConfig's own Quick/
            Manual choice screen, the same question asked a second time. */}
        <button
          type="button"
          onClick={onManual}
          className="h-10 rounded-xl border border-slate-200 bg-white px-5 text-[12.5px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Manual Connect
        </button>
      </div>
    );
  return (
    <Button
      type="button"
      onClick={onAdvanced}
      className="h-11 w-full rounded-xl bg-[#5B5CF6] px-5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(91,92,246,0.22)] hover:bg-[#4949E8] sm:w-auto"
    >
      Configure {CHANNELS[channel].label}
      <ArrowRight className="h-4 w-4" />
    </Button>
  );
}

export function ChannelsTab() {
  const [channel, setChannel] = useState<ChannelKey>('whatsapp');
  const [view, setView] = useState<'onboarding' | 'config' | 'profile'>(
    'onboarding'
  );
  const [preferredConnectMethod, setPreferredConnectMethod] = useState<
    'quick' | 'manual'
  >('quick');
  // Whether each channel is ALREADY connected, checked once per channel
  // and cached — without this, switching to an already-connected channel
  // always showed the "Connect X" marketing page (this section), with no
  // way to tell it was already set up short of clicking through it.
  const [statusCache, setStatusCache] = useState<
    Partial<Record<ChannelKey, boolean>>
  >({});
  const [checkingStatus, setCheckingStatus] = useState(true);

  const current = CHANNELS[channel];
  const Icon = current.icon;
  const Config = current.Config;
  const Profile = current.Profile;

  useEffect(() => {
    const cached = statusCache[channel];
    if (cached !== undefined) {
      setView(cached ? 'config' : 'onboarding');
      setCheckingStatus(false);
      return;
    }
    let cancelled = false;
    setCheckingStatus(true);
    checkChannelConnected(channel).then((connected) => {
      if (cancelled) return;
      setStatusCache((prev) => ({ ...prev, [channel]: connected }));
      setView(connected ? 'config' : 'onboarding');
      setCheckingStatus(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  function selectChannel(next: ChannelKey) {
    setChannel(next);
    setPreferredConnectMethod('quick');
  }
  function goHome() {
    setView(statusCache[channel] ? 'config' : 'onboarding');
  }
  if (checkingStatus) return <PanelLoader />;
  if (view === 'config')
    return (
      <div className="space-y-4">
        <ChannelRail channel={channel} onSelect={selectChannel} />
        <PanelHeader
          icon={Settings2}
          title={`${current.label} connection`}
          onBack={goHome}
        />
        <Config defaultConnectMethod={preferredConnectMethod} />
      </div>
    );
  if (view === 'profile' && Profile)
    return (
      <div className="space-y-4">
        <ChannelRail channel={channel} onSelect={selectChannel} />
        <PanelHeader
          icon={IdCard}
          title={`${current.label} business profile`}
          onBack={goHome}
        />
        <Profile />
      </div>
    );
  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-2">
      <ChannelRail channel={channel} onSelect={selectChannel} />
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(42,51,86,0.06)]">
        <div className="grid lg:grid-cols-[1.55fr_0.85fr]">
          <div className="relative min-h-[310px] overflow-hidden p-7 sm:p-9">
            <div
              className="absolute bottom-0 -left-10 h-48 w-48 rounded-full blur-3xl"
              style={{ backgroundColor: current.pale }}
            />
            <div
              className="absolute top-8 right-12 h-4 w-4 rounded-full opacity-60"
              style={{ backgroundColor: current.accent }}
            />
            <div className="relative flex h-full flex-col items-center justify-center gap-6 sm:flex-row sm:text-left">
              <div
                className="flex h-32 w-32 shrink-0 items-center justify-center rounded-[38px] bg-white shadow-[0_18px_45px_rgba(25,35,70,0.14)] ring-8 ring-white"
                style={{ boxShadow: `0 18px 45px ${current.accent}26` }}
              >
                <Icon className="h-20 w-20" />
              </div>
              <div className="max-w-sm text-center sm:text-left">
                <span className="inline-flex rounded-full bg-[#EEF0FF] px-3 py-1 text-[10px] font-bold text-[#5B5CF6]">
                  RECOMMENDED
                </span>
                <h2 className="mt-4 text-[25px] font-bold tracking-tight text-slate-900">
                  Connect {current.label}
                </h2>
                <p className="mt-3 text-[13px] leading-6 text-slate-500">
                  {current.description}
                </p>
                <div className="mt-6">
                  <ConnectionAction
                    channel={channel}
                    onConnected={() => {
                      setStatusCache((prev) => ({ ...prev, [channel]: true }));
                      setView('config');
                    }}
                    onManual={() => {
                      setPreferredConnectMethod('manual');
                      setView('config');
                    }}
                    onAdvanced={() => setView('config')}
                  />
                </div>
                {current.hasProfile && (
                  <button
                    type="button"
                    onClick={() => setView('profile')}
                    className="mt-3 text-[12px] font-semibold text-[#5B5CF6] hover:text-[#4848df]"
                  >
                    Manage business profile
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 bg-slate-50/45 p-7 lg:border-t-0 lg:border-l">
            <Benefit
              icon={MessageCircle}
              title="Real-time messaging"
              copy="Reply instantly to customer messages"
              color="#23C66B"
            />
            <Benefit
              icon={Zap}
              title="Automate conversations"
              copy="Save time with automated workflows"
              color="#23C66B"
            />
            <Benefit
              icon={ChartNoAxesCombined}
              title="Track performance"
              copy="Monitor your messaging analytics"
              color="#3385FF"
            />
            <Benefit
              icon={Target}
              title="Increase engagement"
              copy="Build stronger customer relationships"
              color="#6C63FF"
            />
          </div>
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_30px_rgba(42,51,86,0.045)]">
        <h3 className="text-[14px] font-bold text-slate-900">
          About this connection
        </h3>
        <p className="mt-1 text-[12px] text-slate-500">
          Secure, easy, and reliable connection via {current.provider}.
        </p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Trust
            icon={ShieldCheck}
            title="Secure Connection"
            copy="Your data is encrypted and safe"
            color="#22C55E"
          />
          <Trust
            icon={BadgeCheck}
            title="Official Integration"
            copy="Connected through the official API"
            color="#3385FF"
          />
          <Trust
            icon={CircleUserRound}
            title="Business Ready"
            copy="Built for your whole team"
            color="#6C63FF"
          />
          <Trust
            icon={Zap}
            title="Quick Setup"
            copy="Connect in just a few minutes"
            color="#F59E0B"
          />
        </div>
      </section>
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_30px_rgba(42,51,86,0.045)]">
        <div className="absolute -right-14 bottom-0 h-48 w-48 rounded-full bg-[#F0EEFF] blur-3xl" />
        <div className="relative grid gap-7 lg:grid-cols-[1fr_220px] lg:items-center">
          <div>
            <h3 className="text-[14px] font-bold text-slate-900">
              Connection requirements
            </h3>
            <p className="mt-1 text-[12px] text-slate-500">
              Make sure you have the following to get started.
            </p>
            <div className="mt-6 space-y-4">
              <Requirement
                title={`A ${current.provider} account with admin access`}
                copy="You'll use this account to connect your business channel."
              />
              <Requirement
                title={`A ${current.label} business account`}
                copy="Create one or use your existing business account."
              />
              <Requirement
                title="Business verification"
                copy="Some provider features require a verified business."
              />
            </div>
          </div>
          <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-[42px] bg-[#F0EEFF] shadow-[0_20px_35px_rgba(99,91,255,0.2)]">
            <Check className="h-20 w-20 text-[#6C63FF]" strokeWidth={3} />
          </div>
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_30px_rgba(42,51,86,0.045)]">
        <h3 className="text-[14px] font-bold text-slate-900">How it works</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          Follow these simple steps to connect {current.label}.
        </p>
        <div className="mt-7 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Step
            number="1"
            icon={FacebookIcon}
            title={`Connect ${current.provider}`}
            copy="Authorize your business account."
          />
          <Step
            number="2"
            icon={Icon}
            title={`Select ${current.label}`}
            copy="Choose or create your business channel."
          />
          <Step
            number="3"
            icon={Settings2}
            title="Complete setup"
            copy="Grant the necessary permissions."
          />
          <Step
            number="4"
            icon={Check}
            title="Start messaging"
            copy="You are ready to chat with customers."
          />
        </div>
      </section>
      <section className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-[#E7E5FF] bg-[linear-gradient(90deg,#F7F6FF,#FBFBFF)] p-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EEEEFF] text-[#5B5CF6]">
            <CircleHelp className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[13px] font-bold text-slate-800">
              Need help connecting?
            </p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Our support team is here to help you set up {current.label}.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setView('config')}
          className="rounded-xl border border-[#B8B4FF] bg-white px-4 py-2.5 text-[12.5px] font-bold text-[#5B5CF6] transition hover:bg-[#F7F6FF]"
        >
          View setup guide
        </button>
      </section>
      <div className="flex flex-col justify-between gap-2 border-t border-slate-200 px-2 pt-4 text-[11px] text-slate-400 sm:flex-row">
        <span className="inline-flex items-center gap-1.5">
          <LockKeyhole className="h-3.5 w-3.5 text-[#5B5CF6]" />
          Your data is secure and encrypted end-to-end.
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium text-[#5B5CF6]">
          <Lightbulb className="h-3.5 w-3.5" />
          Learn more about channels
        </span>
      </div>
    </div>
  );
}

/** A lightweight breadcrumb row — deliberately NOT a bordered/boxed bar
 *  (that older shape read as a second, redundant header once a channel's
 *  own config screen — WhatsApp's, so far — has its own rich hero
 *  underneath). Labeled "All Channels" rather than "Back to overview" so
 *  it reads as a distinct action from WhatsApp's own internal
 *  "Back to overview" (which returns to ITS connected-dashboard view,
 *  not out to the channel picker). */
function PanelHeader({
  icon: Icon,
  title,
  onBack,
}: {
  icon: IconComponent;
  title: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-600">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#EEF0FF]">
          <Icon className="h-3.5 w-3.5 text-[#5B5CF6]" />
        </span>
        {title}
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        className="h-8 px-3 text-[12.5px] border-slate-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All Channels
      </Button>
    </div>
  );
}
function ChannelRail({
  channel,
  onSelect,
}: {
  channel: ChannelKey;
  onSelect: (channel: ChannelKey) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_4px_18px_rgba(42,51,86,0.035)]">
      <div className="flex min-w-max items-center gap-1">
        <div className="flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-[#5B5CF6]">
          <Sparkles className="h-4 w-4" />
          All Channels
        </div>
        {CHANNEL_KEYS.map((key) => {
          const item = CHANNELS[key];
          const ItemIcon = item.icon;
          const active = key === channel;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12px] font-semibold transition ${active ? 'border border-[#D9D8FF] bg-white text-[#38375D] shadow-[0_3px_10px_rgba(91,92,246,0.12)]' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
            >
              <ItemIcon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
function Benefit({
  icon: Icon,
  title,
  copy,
  color,
}: {
  icon: IconComponent;
  title: string;
  copy: string;
  color: string;
}) {
  return (
    <div className="flex gap-3 py-2.5">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}14`, color }}
      >
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div>
        <p className="text-[12px] font-bold text-slate-800">{title}</p>
        <p className="mt-0.5 text-[11.5px] leading-5 text-slate-500">{copy}</p>
      </div>
    </div>
  );
}
function Trust({
  icon: Icon,
  title,
  copy,
  color,
}: {
  icon: IconComponent;
  title: string;
  copy: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}14`, color }}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div>
        <p className="text-[11.5px] font-bold text-slate-800">{title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{copy}</p>
      </div>
    </div>
  );
}
function Requirement({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EAFBF0] text-[#22C55E]">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
      <div>
        <p className="text-[12px] font-bold text-slate-800">{title}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{copy}</p>
      </div>
    </div>
  );
}
function Step({
  number,
  icon: Icon,
  title,
  copy,
}: {
  number: string;
  icon: IconComponent;
  title: string;
  copy: string;
}) {
  return (
    <div className="text-center">
      <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-[#5B5CF6] text-[11px] font-bold text-white">
        {number}
      </span>
      <span className="mx-auto mt-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F2F1FF]">
        <Icon className="h-7 w-7" />
      </span>
      <p className="mt-4 text-[12px] font-bold text-slate-800">{title}</p>
      <p className="mx-auto mt-1 max-w-[150px] text-[11px] leading-5 text-slate-500">
        {copy}
      </p>
    </div>
  );
}
