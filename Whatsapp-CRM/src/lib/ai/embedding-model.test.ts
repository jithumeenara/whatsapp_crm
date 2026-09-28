import { describe, it, expect } from 'vitest'
import { TaskType } from '@google/generative-ai'
import { embeddingRequest, isEmbeddingModel } from './embeddings'

describe('what each embedding model is sent', () => {
  it('keeps the original model on task types, text unchanged', () => {
    expect(embeddingRequest('fee details', 'query', 'gemini-embedding-001')).toEqual({ text: 'fee details', taskType: TaskType.RETRIEVAL_QUERY })
    expect(embeddingRequest('Fees\nSTP 5900', 'document', 'gemini-embedding-001')).toEqual({ text: 'Fees\nSTP 5900', taskType: TaskType.RETRIEVAL_DOCUMENT })
  })

  it('gives the new model its task in the text, in the documented format', () => {
    expect(embeddingRequest('fee details', 'query', 'gemini-embedding-2')).toEqual({ text: 'task: search result | query: fee details' })
    expect(embeddingRequest('Fees\nSTP 5900', 'document', 'gemini-embedding-2')).toEqual({ text: 'title: none | text: Fees\nSTP 5900' })
  })

  it('accepts only the listed models', () => {
    expect(isEmbeddingModel('gemini-embedding-2')).toBe(true)
    expect(isEmbeddingModel('text-embedding-3-large')).toBe(false)
    expect(isEmbeddingModel(undefined)).toBe(false)
  })
})
