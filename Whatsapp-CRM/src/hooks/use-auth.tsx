"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useSession, signOut as nextAuthSignOut } from "next-auth/react";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import {
  canEditSettings as canEditSettingsFor,
  canEditWhatsAppConfig as canEditWhatsAppConfigFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  canViewAllLeads as canViewAllLeadsFor,
  isAccountRole,
  type AccountRole,
} from "@/lib/auth/roles";

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  account_id: string | null;
  account_role: AccountRole | null;
}

interface AccountSummary {
  id: string;
  name: string;
  default_currency: string;
}

interface AuthContextValue {
  userId: string | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  accountId: string | null;
  accountRole: AccountRole | null;
  account: AccountSummary | null;
  defaultCurrency: string;
  isOwner: boolean;
  isAdmin: boolean;
  isSupervisor: boolean;
  isAgent: boolean;
  isViewer: boolean;
  canManageMembers: boolean;
  canEditSettings: boolean;
  canEditWhatsAppConfig: boolean;
  canSendMessages: boolean;
  canViewAllLeads: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const loading = status === "loading";
  const userId = session?.user?.id ?? null;

  const fetchProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return;
      const data = await res.json();
      if (data.profile) {
        const accountRole = isAccountRole(data.profile.account_role)
          ? data.profile.account_role
          : null;
        setProfile({
          id: data.profile.id,
          full_name: data.profile.full_name,
          email: data.profile.email,
          avatar_url: data.profile.avatar_url,
          account_id: data.profile.account_id,
          account_role: accountRole,
        });
        if (data.account) {
          setAccount({
            id: data.account.id,
            name: data.account.name,
            default_currency: data.account.default_currency ?? DEFAULT_CURRENCY,
          });
        }
      }
    } catch (err) {
      console.error("[AuthProvider] fetchProfile threw:", err);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated" && userId) {
      fetchProfile();
    } else if (status === "unauthenticated") {
      setProfile(null);
      setAccount(null);
      setProfileLoading(false);
    }
  }, [status, userId, fetchProfile]);

  const signOut = useCallback(async () => {
    await nextAuthSignOut({ callbackUrl: "/login" });
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    await fetchProfile();
  }, [userId, fetchProfile]);

  const derived = useMemo(() => {
    const role = profile?.account_role ?? null;
    return {
      accountRole: role,
      accountId: profile?.account_id ?? null,
      isOwner: role === "owner",
      isAdmin: role === "admin",
      isSupervisor: role === "supervisor",
      isAgent: role === "agent",
      isViewer: role === "viewer",
      canManageMembers: role ? canManageMembersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canEditWhatsAppConfig: role ? canEditWhatsAppConfigFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
      canViewAllLeads: role ? canViewAllLeadsFor(role) : false,
    };
  }, [profile?.account_role, profile?.account_id]);

  return (
    <AuthContext.Provider
      value={{
        userId,
        profile,
        loading,
        profileLoading,
        signOut,
        refreshProfile,
        account,
        defaultCurrency: account?.default_currency ?? DEFAULT_CURRENCY,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      userId: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
      account: null,
      defaultCurrency: DEFAULT_CURRENCY,
      accountId: null,
      accountRole: null,
      isOwner: false,
      isAdmin: false,
      isSupervisor: false,
      isAgent: false,
      isViewer: false,
      canManageMembers: false,
      canEditSettings: false,
      canEditWhatsAppConfig: false,
      canSendMessages: false,
      canViewAllLeads: false,
    };
  }
  return ctx;
}
