import { GoogleGenerativeAI } from '@google/generative-ai'

export interface GeminiConfig {
  apiKey: string
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  trainingData?: Array<{ question: string; answer: string }>
}

export async function generateAiReply(
  config: GeminiConfig,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'model'; text: string }> = [],
): Promise<string> {
  const genAI = new GoogleGenerativeAI(config.apiKey, { apiVersion: 'v1' })
  const model = genAI.getGenerativeModel({
    model: config.model ?? 'gemini-2.0-flash',
    generationConfig: {
      temperature: config.temperature ?? 0.7,
      maxOutputTokens: config.maxTokens ?? 500,
    },
    systemInstruction: buildSystemInstruction(config),
  })

  const history = conversationHistory.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }))

  const chat = model.startChat({ history })
  const result = await chat.sendMessage(userMessage)
  return result.response.text()
}

function buildSystemInstruction(config: GeminiConfig): string {
  const parts: string[] = []

  if (config.systemPrompt) {
    parts.push(config.systemPrompt)
  }

  if (config.trainingData && config.trainingData.length > 0) {
    parts.push('\n\nKnowledge base (use these to answer questions accurately):')
    for (const item of config.trainingData) {
      if (item.question && item.answer) {
        parts.push(`Q: ${item.question}\nA: ${item.answer}`)
      }
    }
  }

  return parts.join('\n\n') || 'You are a helpful assistant.'
}
