/**
 * Best-effort, real device/browser label derived from a User-Agent string
 * — never fabricated. Used once at login time (auth.ts's authorize()) to
 * label a new UserSession row; the Settings > Profile > Sessions list
 * then just displays what was actually recorded, it doesn't re-detect
 * anything.
 */
export function deriveDeviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";

  let os = "Unknown OS";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  let browser = "Unknown browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";

  return `${os} • ${browser}`;
}
