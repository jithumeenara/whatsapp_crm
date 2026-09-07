-- Auto-transcription of inbound WhatsApp voice notes — see
-- src/lib/whatsapp/audio-transcription.ts. Only Gemini and OpenAI support
-- transcription today (confirmed against official docs); an account with
-- neither key configured simply never populates this column.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS transcript TEXT;
