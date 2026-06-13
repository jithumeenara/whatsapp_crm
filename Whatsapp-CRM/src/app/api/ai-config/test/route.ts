import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { generateAiReply } from '@/lib/ai/gemini'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) {
    return NextResponse.json({ error: 'No account linked.' }, { status: 403 })
  }

  const body = await req.json()
  const { message, api_key: rawKey, model, temperature, max_tokens, system_prompt, training_data } =
    body as {
      message?: string
      api_key?: string
      model?: string
      temperature?: number
      max_tokens?: number
      system_prompt?: string
      training_data?: Array<{ question: string; answer: string }>
    }

  if (!message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  // Resolve API key: prefer the one sent in the request body (unsaved),
  // fall back to the stored encrypted key.
  let apiKey: string
  if (rawKey?.trim()) {
    apiKey = rawKey.trim()
  } else {
    const stored = await prisma.aiConfig.findUnique({
      where: { account_id: profile.account_id },
      select: { api_key: true },
    })
    if (!stored?.api_key) {
      return NextResponse.json(
        { error: 'No API key configured. Save your API key first or enter one to test.' },
        { status: 400 },
      )
    }
    apiKey = decrypt(stored.api_key)
  }

  try {
    const reply = await generateAiReply(
      {
        apiKey,
        model: model ?? 'gemini-2.0-flash',
        temperature: temperature ?? 0.7,
        maxTokens: max_tokens ?? 500,
        systemPrompt: system_prompt || undefined,
        trainingData: training_data ?? [],
      },
      message.trim(),
    )
    return NextResponse.json({ reply })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Surface Gemini-specific errors clearly
    if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
      return NextResponse.json(
        { error: 'Invalid API key. Check it at aistudio.google.com.' },
        { status: 400 },
      )
    }
    if (msg.includes('PERMISSION_DENIED')) {
      return NextResponse.json(
        { error: 'API key does not have permission for this model.' },
        { status: 400 },
      )
    }
    if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
      return NextResponse.json(
        { error: 'Quota exceeded. Check your Gemini API usage limits.' },
        { status: 429 },
      )
    }
    return NextResponse.json({ error: `Gemini error: ${msg}` }, { status: 500 })
  }
}
