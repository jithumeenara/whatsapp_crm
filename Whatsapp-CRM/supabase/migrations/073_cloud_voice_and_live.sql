-- 073 — better voices, and the live voice console.
--
-- Cloud TTS is preferred over the built-in Gemini voice wherever the
-- server has a Google Cloud service account: roughly one second per
-- reply instead of eight, native Malayalam voices rather than an
-- English-trained one speaking Malayalam, and OGG/Opus output that
-- WhatsApp renders as a real voice note instead of a file attachment.
--
-- The service account itself lives in the environment, never here. A
-- private key grants access to an entire Cloud project, which is a far
-- wider blast radius than the per-account API keys in provider_keys, so
-- it is deliberately not a per-tenant database value.

ALTER TABLE ai_configs
  -- Chirp3-HD voice "character". The language half of the voice name is
  -- derived from the reply text at send time, so one choice here gives a
  -- consistent-sounding assistant across every language it answers in.
  ADD COLUMN IF NOT EXISTS cloud_voice TEXT NOT NULL DEFAULT 'Achernar',

  -- The real-time voice console in Settings. Off by default: it opens a
  -- streaming session that bills for audio in both directions, and it is
  -- a testing tool rather than something a customer ever touches.
  ADD COLUMN IF NOT EXISTS live_voice_enabled BOOLEAN NOT NULL DEFAULT false,

  -- Gemini Live model for that console. Stored rather than hardcoded
  -- because the native-audio models are all preview and get withdrawn.
  ADD COLUMN IF NOT EXISTS live_voice_model TEXT NOT NULL
    DEFAULT 'models/gemini-2.5-flash-native-audio-preview-12-2025',

  -- Prebuilt voice for the live session. Separate from cloud_voice: the
  -- Live API speaks with its own voice set and does not use Cloud TTS.
  ADD COLUMN IF NOT EXISTS live_voice_name TEXT NOT NULL DEFAULT 'Kore';
