'use client';

import { MetaPlatformConfig } from '@/components/settings/meta-platform-config';

/**
 * A thin wrapper — MetaPlatformConfig owns all the real logic. Used to
 * also add page-level header framing here, but the Settings shell now
 * renders that consistently for every tab (see TAB_TITLES/TAB_DESCRIPTIONS
 * in settings/page.tsx), so this just forwards straight through.
 */
export function PlatformMetaTab() {
  return <MetaPlatformConfig defaultOpen />;
}
