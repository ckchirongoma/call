### Task 0.3: Model layer (port) and `model_config` loading

**Files:** Create `api/_lib/models.ts` (port of `../charlie/api/_lib/models.ts`), `api/_lib/jobctx.ts` (port), `test/models.test.ts`. Modify `test/_fakes.ts` if `onModel` needs `finish_reason` support.

**Interfaces:**
- `type Role = "extract"|"needs"|"writer"|"checker"|"safety"|"voice"|"summary"`.
- `askJSON<T>(role: Role, prompt: string, opts: { maxTokens?: number; schema?: (x: unknown) => x is T; jsonMode?: boolean; deadlineMs?: number; sessionId?: string }): Promise<{ value: T; model: string; usage: {in: number; out: number} }>`.
- `askText(role, prompt, opts)` same shape with `value: string`.
- `transcribeAudio(bytes: Uint8Array, mime: string, opts): Promise<{ text: string; segments?: {start: number; end: number; text: string}[]; language?: string }>` using the `voice` row (`provider` openrouter|groq|openai).
- `HARD_FALLBACKS: string[]` (copy Charlie's current list), `MIN_MAX_TOKENS = 1200`, `loadModelConfig(role): Promise<ModelConfig>` cached 60 s.
- Errors: `ModelUnavailable`, `ModelBadRequest`, `DeadlineError`.

- [ ] **Step 1: Failing tests** `[C-1500]…[C-1525]`: scripted gateway returns `finish_reason: "length"` once → second call has doubled `max_tokens`; 429 → fallback called with no delay (fake clock unchanged); 400 → `ModelBadRequest`, no fallback; fences/trailing commas/prose → parsed; row disabled → fallbacks + incident; cache 60 s.
- [ ] **Step 2–4:** red → port → green. **Step 5: Commit** `Port the model layer: roles from model_config, fallbacks, truncation retries`

