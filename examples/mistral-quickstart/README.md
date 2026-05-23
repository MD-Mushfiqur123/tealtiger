# TealMistral Quickstart

This example shows how to create a guarded Mistral AI client with TealTiger. It demonstrates:

- creating a `TealMistral` client;
- registering PII and prompt injection guardrails;
- tracking Mistral request cost with model-specific pricing;
- attaching a daily budget and storing request cost records.

## Setup

Install the runtime dependencies from a TypeScript project:

```bash
npm install tealtiger ts-node typescript @types/node
```

Set your Mistral AI API key:

```bash
export MISTRAL_API_KEY=your-mistral-api-key
```

Run the quickstart from the TealTiger repository root:

```bash
npx ts-node examples/mistral-quickstart/index.ts
```

## What It Does

The example sends a `chat.create` request through `TealMistral`:

1. A basic prompt that prints the model response, token count, and tracked cost.
2. A PII prompt that triggers the PII guardrail in `redact` mode and prints the guardrail summary.

At the end it prints a cost summary for the `mistral-quickstart-agent` session.

## Notes

- `TealMistral` uses the OpenAI-compatible `chat.create` API shape.
- The example converts Mistral pricing (`MISTRAL_PRICING`, per 1M tokens) to per-1K values for `CostTracker` so cost metadata is non-zero for `mistral-large-latest`.
- `PromptInjectionGuardrail` uses local pattern matching here so the quickstart only needs a Mistral AI API key.
