# TealTogether Quickstart

This example shows how to create a guarded Together AI client with TealTiger. It demonstrates:

- creating a `TealTogether` client;
- registering PII and content moderation guardrails;
- tracking Together AI request cost with model-specific pricing;
- attaching a daily budget and storing request cost records.

## Setup

Install the runtime dependencies from a TypeScript project:

```bash
npm install tealtiger ts-node typescript @types/node
```

Set your Together AI API key:

```bash
export TOGETHER_API_KEY=your-together-api-key
```

Run the quickstart from the TealTiger repository root:

```bash
npx ts-node examples/together-quickstart/index.ts
```

## What It Does

The example sends two `chat.completions.create` requests through `TealTogether`:

1. A basic prompt that prints the model response, token count, and tracked cost.
2. A PII prompt that triggers the PII guardrail in `redact` mode and prints the redacted text from the guardrail metadata.

At the end it prints a cost summary for the `together-quickstart-agent` session.

## Notes

- `TealTogether` uses the OpenAI-compatible `chat.completions.create` shape.
- The example registers Together AI pricing from `TOGETHER_PRICING` with `CostTracker` so cost metadata is non-zero for `meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo`.
- `ContentModerationGuardrail` uses local pattern matching here (`useOpenAI: false`) so the quickstart only needs a Together AI API key.
