import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AiGenerateArgs, AiProviderAdapter, ClassifiedAiError } from './types'

async function generateReply(args: AiGenerateArgs): Promise<string> {
  const genAI = new GoogleGenerativeAI(args.apiKey)
  const model = genAI.getGenerativeModel({
    model: args.model,
    generationConfig: {
      temperature: args.temperature,
      maxOutputTokens: args.maxTokens,
    },
    systemInstruction: args.systemPrompt || 'You are a helpful assistant.',
  })

  const history = args.conversationHistory.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }))

  const chat = model.startChat({ history })
  const result = await chat.sendMessage(args.userMessage)
  return result.response.text()
}

function classifyError(err: unknown): ClassifiedAiError {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
    return { message: 'Invalid API key. Check it at aistudio.google.com.', retryable: false }
  }
  if (msg.includes('PERMISSION_DENIED')) {
    return { message: 'API key does not have permission for this model.', retryable: false }
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    return { message: 'Quota exceeded. Check your Gemini API usage limits.', retryable: true }
  }
  return { message: `Gemini error: ${msg}`, retryable: false }
}

export const geminiAdapter: AiProviderAdapter = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultModels: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (fast, recommended)' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite (cheapest)' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (highest quality)' },
  ],
  generateReply,
  classifyError,
}
