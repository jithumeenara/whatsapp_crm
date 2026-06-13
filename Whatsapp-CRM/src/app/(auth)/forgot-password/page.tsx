"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageSquare, CheckCircle, ArrowLeft, ShieldCheck } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 500));
    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F0F2F5] px-4">
        <div className="w-full max-w-md rounded-2xl bg-white px-8 py-10 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366]/10">
              <CheckCircle className="h-7 w-7 text-[#25D366]" />
            </div>
            <h2 className="mb-2 text-xl font-bold text-gray-900">Request received</h2>
            <p className="mb-6 text-sm text-gray-500">
              Contact your administrator to reset the password for{" "}
              <span className="font-medium text-gray-800">{email}</span>.
            </p>
            <Link href="/login" className="w-full">
              <Button className="h-11 w-full rounded-lg bg-[#25D366] font-semibold text-white hover:bg-[#1aad55]">
                Back to sign in
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F0F2F5] px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#25D366]">
            <MessageSquare className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-semibold text-[#075E54]">WhatsApp CRM Pro</span>
        </div>

        <div className="rounded-2xl bg-white px-8 py-10 shadow-sm">
          <h2 className="mb-1 text-2xl font-bold text-gray-900">Reset password</h2>
          <p className="mb-7 text-sm text-gray-500">
            Enter your email and contact your administrator to reset access.
          </p>

          <form onSubmit={handleReset} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-10 rounded-lg border-gray-200 bg-gray-50 text-gray-900 placeholder:text-gray-400 focus-visible:border-[#25D366] focus-visible:ring-[#25D366]/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-lg bg-[#25D366] font-semibold text-white hover:bg-[#1aad55] disabled:opacity-50"
            >
              {loading ? "Sending..." : "Submit request"}
            </Button>
          </form>

          <Link
            href="/login"
            className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>

          <div className="mt-8 flex items-center justify-center gap-1.5 text-xs text-gray-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Security Verified: Enterprise SSL Encryption</span>
          </div>
        </div>
      </div>
    </div>
  );
}
