"use client"

import { useState } from "react"
import { InstagramTab } from "./instagram-tab"
import { FacebookTab } from "./facebook-tab"

// Instagram gradient SVG icon
function IgIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ig-g1" cx="19%" cy="99%" r="128%">
          <stop offset="0%" stopColor="#ffd600"/>
          <stop offset="50%" stopColor="#ff6930"/>
          <stop offset="75%" stopColor="#fd3191"/>
          <stop offset="100%" stopColor="#8a3df5"/>
        </radialGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#ig-g1)"/>
      <rect x="14" y="14" width="20" height="20" rx="5.5" stroke="white" strokeWidth="2.4" fill="none"/>
      <circle cx="24" cy="24" r="5" stroke="white" strokeWidth="2.4" fill="none"/>
      <circle cx="31" cy="17" r="1.4" fill="white"/>
    </svg>
  )
}

// Facebook blue icon
function FbIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="12" fill="#1877F2"/>
      <path d="M28.5 25.5H25.5V36H21V25.5H18V21.5H21V19C21 15.8 22.9 14 25.8 14C27.2 14 28.5 14.1 28.5 14.1V17H26.9C25.4 17 25 17.8 25 18.8V21.5H28.5L28 25.5Z" fill="white"/>
    </svg>
  )
}

type Tab = "instagram" | "facebook"

export function SocialMediaShell() {
  const [activeTab, setActiveTab] = useState<Tab>("instagram")

  return (
    <div className="flex h-full flex-col bg-[#F4F6FA]">
      {/* Header */}
      <div className="flex-none bg-white border-b border-slate-200 px-6 pt-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">Social Media</h1>
            <p className="text-[13px] text-slate-500 mt-0.5">Manage your Instagram and Facebook presence</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab("instagram")}
            className={`flex items-center gap-2.5 px-5 py-3 text-[13px] font-semibold border-b-2 transition-colors ${
              activeTab === "instagram"
                ? "border-[#E1306C] text-[#E1306C]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <IgIcon className="h-5 w-5" />
            Instagram
          </button>
          <button
            onClick={() => setActiveTab("facebook")}
            className={`flex items-center gap-2.5 px-5 py-3 text-[13px] font-semibold border-b-2 transition-colors ${
              activeTab === "facebook"
                ? "border-[#1877F2] text-[#1877F2]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <FbIcon className="h-5 w-5" />
            Facebook
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "instagram" && <InstagramTab />}
        {activeTab === "facebook"  && <FacebookTab />}
      </div>
    </div>
  )
}
