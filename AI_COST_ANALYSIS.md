# AI Cost Analysis

## Development & Testing Costs

### LLM Provider
- **Model:** OpenAI `gpt-4o-mini` (backend-owned generation)
- **Usage:** All chat completions route through the bridge-backend, which calls OpenAI with dynamic tool definitions injected per session

### Development Spend (Estimated)

| Metric | Value |
|--------|-------|
| LLM API Provider | OpenAI |
| Model | gpt-4o-mini |
| Total API calls (dev + testing) | ~500 |
| Avg input tokens per call | ~1,200 |
| Avg output tokens per call | ~400 |
| Total input tokens | ~600,000 |
| Total output tokens | ~200,000 |
| Input cost ($0.15 / 1M tokens) | $0.09 |
| Output cost ($0.60 / 1M tokens) | $0.12 |
| **Total LLM dev spend** | **~$0.21** |

### Other AI-Related Costs

| Item | Cost |
|------|------|
| Embedding / RAG | Not used in production flow |
| Hosting (Railway) | ~$5/month (4 services on hobby plan) |
| Supabase (database + auth) | Free tier |
| **Total monthly infrastructure** | **~$5/month** |

## Production Cost Projections

### Assumptions
- Average sessions per user per month: **10**
- Average messages per session: **8**
- Average tool invocations per session: **1.5**
- Average input tokens per message: **1,200** (includes system prompt + tool definitions + conversation history)
- Average output tokens per message: **400**
- Tool invocation adds ~200 extra input tokens (tool result context)
- Model: `gpt-4o-mini` at $0.15/1M input, $0.60/1M output

### Per-User Monthly Token Consumption
- Messages per user/month: 10 sessions x 8 messages = **80 messages**
- Input tokens: 80 x 1,200 = **96,000 tokens**
- Output tokens: 80 x 400 = **32,000 tokens**
- Tool overhead: 10 x 1.5 x 200 = **3,000 extra input tokens**
- **Total per user:** 99,000 input + 32,000 output

### Cost at Scale

| Scale | Users | Monthly Input Tokens | Monthly Output Tokens | Input Cost | Output Cost | Infra Cost | **Total/month** |
|-------|-------|---------------------|----------------------|------------|-------------|------------|-----------------|
| Small | 100 | 9.9M | 3.2M | $1.49 | $1.92 | $10 | **~$13** |
| Medium | 1,000 | 99M | 32M | $14.85 | $19.20 | $25 | **~$59** |
| Large | 10,000 | 990M | 320M | $148.50 | $192.00 | $100 | **~$441** |
| Enterprise | 100,000 | 9.9B | 3.2B | $1,485 | $1,920 | $500 | **~$3,905** |

### Infrastructure Cost Breakdown at Scale

| Component | 100 Users | 1K Users | 10K Users | 100K Users |
|-----------|-----------|----------|-----------|------------|
| Railway backend | $5 | $10 | $40 | $200 |
| Railway frontend | $0 (static) | $0 | $5 | $50 |
| Railway app services (4) | $0 | $5 | $20 | $100 |
| Supabase (DB + Auth) | $0 (free) | $25 (Pro) | $25 | $100 |
| CDN / bandwidth | $0 | $0 | $10 | $50 |
| **Infra subtotal** | **$5** | **$40** | **$100** | **$500** |

### Cost Optimization Strategies

1. **Model selection:** `gpt-4o-mini` is already the cheapest capable model for function calling. Could drop to `gpt-3.5-turbo` for simple queries but lose tool-calling reliability.
2. **Context window management:** Compaction is built in — older messages are summarized to reduce token count in long conversations.
3. **Caching:** Common tool definitions are static per class and could be cached in the system prompt rather than re-fetched.
4. **Rate limiting:** Already implemented per-user, per-session, and per-app rate limits to prevent abuse.
5. **Tiered models:** Route simple queries to cheaper models, use `gpt-4o-mini` only when tool calling is needed.

### Key Observations

- LLM costs dominate at every scale — infrastructure is <15% of total cost
- At 100K users, cost per user is ~$0.04/month — very sustainable
- The biggest cost driver is conversation length (context window growth), not tool invocations
- Tool invocations add minimal cost (~3% overhead) since tool results are small
- Switching to Anthropic Claude would have similar cost characteristics
