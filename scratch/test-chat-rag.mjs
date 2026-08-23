import { __test } from '../api/chat-groq.js';

console.log('Testing live RAG synthesis for CM of Tamil Nadu...');
const rag = await __test.resolveContextualLiveQuery ? 'available' : 'no';
console.log('Helpers available:', rag);
