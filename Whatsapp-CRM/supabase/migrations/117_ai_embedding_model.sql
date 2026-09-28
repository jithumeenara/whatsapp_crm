-- Which model an account searches its knowledge by meaning with
-- (src/lib/ai/embeddings.ts): 'gemini-embedding-001' (null = this) or
-- 'gemini-embedding-2'. Read with plain SQL, not through Prisma, so a
-- database without it keeps working; also added when first changed.
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS embedding_model TEXT;
