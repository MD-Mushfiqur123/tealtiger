# Cohere Quickstart with RAG

This example shows how to build a guarded Cohere client with TealTiger. It demonstrates:

- creating a `GuardedCohere` wrapper that integrates the `cohere-ai` SDK with TealTiger;
- registering PII and content moderation guardrails;
- tracking Cohere request cost with model-specific pricing;
- attaching a daily budget and storing request cost records;
- using Cohere's RAG (Retrieval-Augmented Generation) with documents and citations.

## Setup

Install the runtime dependencies:

```bash
npm install tealtiger cohere-ai ts-node typescript @types/node
```

Set your Cohere API key:

```bash
export COHERE_API_KEY=your-cohere-api-key
```

Run the quickstart from the TealTiger repository root:

```bash
npx ts-node examples/cohere-quickstart/index.ts
```

## What It Does

The example sends three `chat` requests through a guarded Cohere wrapper:

1. **Basic request** — a simple prompt that prints the model response, token count, and tracked cost.
2. **RAG request** — passes three TealTiger knowledge-base documents to Cohere's Command model and prints the grounded response along with any source citations.
3. **PII guardrail request** — sends a prompt containing an email address; the PII guardrail redacts it before it reaches the model.

At the end it prints a cost summary for the `cohere-quickstart-agent` session.

## Notes

- The `GuardedCohere` class wraps the [cohere-ai](https://www.npmjs.com/package/cohere-ai) SDK with TealTiger's guardrail, cost-tracking, and budget-management pipeline — the same pattern used internally by `TealDeepSeek` and other TealTiger provider clients.
- Cohere supports RAG natively through the `documents` parameter, making it easy to add grounded knowledge to prompts.
- `ContentModerationGuardrail` uses local pattern matching here (`useOpenAI: false`) so the quickstart only needs a Cohere API key.
- The cost record is stored via `InMemoryCostStorage` and displayed as a session summary at the end.
