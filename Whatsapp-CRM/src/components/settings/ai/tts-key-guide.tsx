'use client';

/**
 * How to get the Google Cloud voice key, for somebody who has never
 * opened Google Cloud Console.
 *
 * ── Why this is a dialog and not a longer hint ──────────────────────
 *
 * The card already carried a one-line version of these steps, and a
 * single sentence naming five screens is a sentence you re-read three
 * times and still get lost in. The instructions are genuinely six
 * screens deep in somebody else's product, so they need room, numbers,
 * and links that land on the exact page — but they are also read once
 * and never again, which is what a dialog behind a question mark is
 * for.
 *
 * ── The step that stops most people ─────────────────────────────────
 *
 * Google turned service-account keys off by default. Any project
 * created after 3 May 2024 has the `iam.disableServiceAccountKeyCreation`
 * organization policy enforced, and the Create button simply fails —
 * with an error about a policy, not about anything the person did. That
 * is the single most likely reason somebody following these steps gets
 * stuck, so it is called out where it happens rather than left as
 * troubleshooting at the bottom.
 *
 * The other ordering trap: the Cloud Text-to-Speech User role does not
 * appear in the role picker until the API is enabled on the project,
 * which is why enabling comes first here even though most guides start
 * by making the service account.
 *
 * Verified against Google's own docs, September 2026 —
 * docs.cloud.google.com/iam/docs/keys-create-delete (the Keys → Add key
 * → Create new key → JSON flow, the May 2024 default, and "after you
 * download the key file, you cannot download it again") and
 * docs.cloud.google.com/text-to-speech/docs/before-you-begin (enabling
 * the API, billing).
 */

import { useState } from 'react';
import {
  HelpCircle,
  ArrowDown,
  ExternalLink,
  AlertTriangle,
  ShieldAlert,
  KeyRound,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface Step {
  title: string;
  body: React.ReactNode;
  link?: { href: string; label: string };
}

const STEPS: Step[] = [
  {
    title: 'Open Google Cloud and pick a project',
    body: (
      <>
        Sign in with any Google account. Create a project if you have none — the name does not
        matter. <strong>Billing has to be on</strong>, even though the first 1 million characters
        each month are free.
      </>
    ),
    link: { href: 'https://console.cloud.google.com/projectcreate', label: 'Create a project' },
  },
  {
    title: 'Turn on the Text-to-Speech API',
    body: (
      <>
        On the page below, press <strong>Enable</strong>. Do this before the next step — the voice
        permission does not show up in the list until the API is on, and that missing option is
        what usually sends people round in circles.
      </>
    ),
    link: {
      href: 'https://console.cloud.google.com/apis/library/texttospeech.googleapis.com',
      label: 'Enable Cloud Text-to-Speech API',
    },
  },
  {
    title: 'Make a service account',
    body: (
      <>
        <strong>Create service account</strong> → give it any name → on the permissions step choose
        the role <strong>Cloud Text-to-Speech User</strong> → <strong>Done</strong>. That role, and
        nothing wider: this key only needs to speak.
      </>
    ),
    link: {
      href: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
      label: 'Service accounts',
    },
  },
  {
    title: 'Create the key',
    body: (
      <>
        Click the service account&rsquo;s email address → <strong>Keys</strong> tab →{' '}
        <strong>Add key</strong> → <strong>Create new key</strong> → choose <strong>JSON</strong> →{' '}
        <strong>Create</strong>. The file downloads by itself.
      </>
    ),
  },
  {
    title: 'Upload that file here',
    body: (
      <>
        Press <strong>Upload key</strong> on this card and pick the file exactly as it downloaded —
        do not open or edit it. We run one real test sentence through it before saving, so you find
        out immediately whether it works.
      </>
    ),
  },
];

/** The question mark beside the card's heading. */
export function TtsKeyGuideButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="How do I generate this key?"
        title="How do I generate this key?"
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-slate-300 transition-colors hover:bg-slate-100 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      <GuideDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** The same guide, opened from a sentence rather than an icon — for the
 *  hint under the Upload button, where a person is already reading. */
export function TtsKeyGuideLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700"
      >
        Show me how
      </button>
      <GuideDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function GuideDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
              <KeyRound className="h-3.5 w-3.5" />
            </span>
            Getting the voice key
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Five steps in Google Cloud, about five minutes. Each link opens the exact page.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-0">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <div className="flex gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-[11px] font-semibold text-white tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 pb-1">
                  <p className="text-[13px] font-semibold text-slate-800">{step.title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{step.body}</p>

                  {step.link && (
                    <a
                      href={step.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50/70 px-2.5 py-1.5 text-[11.5px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                    >
                      {step.link.label}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}

                  {/* The wall. Placed on the step where it actually
                      stops people rather than in a troubleshooting
                      list nobody reads before they are stuck. */}
                  {step.title === 'Create the key' && (
                    <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <p className="text-[11.5px] leading-relaxed text-amber-900">
                        <strong>If Create fails with a policy error</strong>, that is Google, not
                        you. Projects made after May 2024 have key creation switched off by
                        default. Go to{' '}
                        <a
                          href="https://console.cloud.google.com/iam-admin/orgpolicies"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium underline underline-offset-2"
                        >
                          Organization policies
                        </a>
                        , find <span className="font-mono text-[10.5px]">Disable service account key creation</span>, and turn it
                        off for this project. On a personal Google account you can do this
                        yourself; on a company account your admin has to.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* The arrow between steps. */}
              {i < STEPS.length - 1 && (
                <div className="flex py-1.5 pl-[11px]" aria-hidden="true">
                  <span className="grid h-5 w-[26px] place-items-center">
                    <ArrowDown className="h-3.5 w-3.5 text-slate-300" />
                  </span>
                </div>
              )}
            </li>
          ))}
        </ol>

        <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200/70">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <p className="text-[11.5px] leading-relaxed text-slate-600">
            Google lets you download that file <strong>once</strong>. If you lose it, delete the
            key and make a new one — there is no way to download the same one again. Keep it off
            WhatsApp and email; anyone who has it can spend your voice quota.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
