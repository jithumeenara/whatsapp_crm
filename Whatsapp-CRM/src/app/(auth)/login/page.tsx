"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { signIn } from "next-auth/react";
import {
  MessageSquare,
  Users,
  Zap,
  Eye,
  EyeOff,
  Mail,
  Lock,
  ShieldCheck,
} from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
      return;
    }

    router.push(
      inviteToken ? `/join/${encodeURIComponent(inviteToken)}` : "/dashboard"
    );
  };

  const features = [
    {
      icon: MessageSquare,
      title: "Centralized Chat Management",
      desc: "Handle all customer queries in one place.",
    },
    {
      icon: Zap,
      title: "Smart Automation",
      desc: "Set up auto-responses and follow-up sequences.",
    },
    {
      icon: Users,
      title: "Team Collaboration",
      desc: "Assign chats and track performance seamlessly.",
    },
  ];

  return (
    <div className="flex min-h-screen bg-[#F2F4F7]">

      {/* ══ LEFT PANEL ══════════════════════════════════════ */}
      <div className="hidden lg:flex lg:w-[55%] flex-col justify-between px-14 py-10">

        {/* Logo */}
        <div className="flex items-center gap-2.5 animate-fade-left">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#25D366] shadow-sm">
            <MessageSquare className="h-5 w-5 text-white" />
          </div>
          <span className="text-[15px] font-bold tracking-tight text-gray-800">
            WhatsApp CRM Pro
          </span>
        </div>

        {/* Center content */}
        <div className="flex flex-col items-start gap-8">

          {/* Floating mascot — no white box, blends on gray */}
          <div className="self-center animate-float">
            <Image
              src="/image.png"
              alt="WhatsApp CRM mascot"
              width={360}
              height={360}
              priority
              className="mix-blend-multiply select-none"
            />
          </div>

          {/* Hero copy */}
          <div className="animate-fade-left animate-delay-200">
            <h1 className="mb-3 text-[38px] font-extrabold leading-tight text-gray-900">
              Power up your{" "}
              <span className="text-[#25D366]">WhatsApp CRM</span>
            </h1>
            <p className="mb-8 text-[15px] leading-relaxed text-gray-500">
              Transform how your team interacts with customers
              <br />
              using our unified communication platform.
            </p>

            {/* Feature list */}
            <div className="space-y-5">
              {features.map(({ icon: Icon, title, desc }, i) => (
                <div
                  key={title}
                  className="flex items-center gap-3.5 animate-fade-left"
                  style={{ animationDelay: `${0.3 + i * 0.1}s` }}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#25D366]/10 border border-[#25D366]/20">
                    <Icon style={{ height: 18, width: 18 }} className="text-[#25D366]" />
                  </div>
                  <div>
                    <p className="text-[13.5px] font-semibold text-gray-800">{title}</p>
                    <p className="text-[13px] text-gray-500">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-1.5 text-xs text-gray-400 animate-fade-left animate-delay-600">
          <ShieldCheck className="h-3.5 w-3.5 text-[#25D366]" />
          <span>© {new Date().getFullYear()} WhatsApp CRM Pro. Security Verified.</span>
        </div>
      </div>

      {/* ══ RIGHT PANEL ═════════════════════════════════════ */}
      <div className="flex w-full lg:w-[45%] items-center justify-center p-6 lg:px-14">
        <div className="w-full max-w-[420px]">

          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden animate-fade-up">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#25D366]">
              <MessageSquare className="h-5 w-5 text-white" />
            </div>
            <span className="text-[15px] font-bold text-gray-800">WhatsApp CRM Pro</span>
          </div>

          {/* Card */}
          <div className="rounded-3xl bg-white px-9 py-10 shadow-[0_8px_40px_rgba(0,0,0,0.09)] animate-fade-right">

            {/* Heading */}
            <div className="mb-8 animate-fade-up animate-delay-100">
              <h2 className="mb-1.5 text-[26px] font-bold text-gray-900">
                {inviteToken ? "Accept Invitation" : "Welcome Back"}
              </h2>
              <p className="text-[13.5px] text-gray-500">
                {inviteToken
                  ? "Sign in and we'll take you to the invitation."
                  : "Please enter your details to sign in."}
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              {error && (
                <div className="animate-fade-up rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              {/* Email */}
              <div className="space-y-1.5 animate-fade-up animate-delay-200">
                <label
                  htmlFor="email"
                  className="block text-[13.5px] font-semibold text-gray-700"
                >
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    id="email"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-12 w-full rounded-xl border border-gray-200 bg-[#F2F4F7] pl-10 pr-4 text-[13.5px] text-gray-900 placeholder:text-gray-400 outline-none transition-all focus:border-[#25D366] focus:bg-white focus:ring-2 focus:ring-[#25D366]/20"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5 animate-fade-up animate-delay-300">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="block text-[13.5px] font-semibold text-gray-700"
                  >
                    Password
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-[13px] font-semibold text-[#25D366] transition hover:text-[#1aad55]"
                  >
                    Forgot Password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-12 w-full rounded-xl border border-gray-200 bg-[#F2F4F7] px-4 pr-11 text-[13.5px] text-gray-900 placeholder:text-gray-400 outline-none transition-all focus:border-[#25D366] focus:bg-white focus:ring-2 focus:ring-[#25D366]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <div className="animate-fade-up animate-delay-400">
                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1 h-12 w-full rounded-xl bg-[#25D366] text-[14.5px] font-bold text-white shadow-sm transition-all hover:bg-[#1fbd5a] hover:shadow-md active:scale-[0.98] disabled:opacity-60"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Signing in…
                    </span>
                  ) : (
                    "Sign In"
                  )}
                </button>
              </div>
            </form>

            {/* Sign up link */}
            <p className="mt-6 text-center text-[13px] text-gray-500 animate-fade-up animate-delay-500">
              Don&apos;t have an account?{" "}
              <Link
                href={
                  inviteToken
                    ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                    : "/signup"
                }
                className="font-semibold text-[#25D366] transition hover:text-[#1aad55]"
              >
                Create an account
              </Link>
            </p>

            {/* Security badge */}
            <div className="mt-8 flex items-center justify-center gap-1.5 text-[11.5px] text-gray-400 animate-fade-up animate-delay-600">
              <Lock className="h-3.5 w-3.5" />
              <span>Security Verified. Enterprise SSL Encryption</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
