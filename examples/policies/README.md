# TealEngine Policy Examples

This directory contains example policy files demonstrating common TealEngine policy patterns. Each file is a valid JSON policy that can be loaded directly into `TealEngine`.

## Policy Reference

The root JSON Schema is at [`schemas/tealtiger-policy.schema.json`](../../schemas/tealtiger-policy.schema.json). All examples include the `$schema` field for editor autocompletion and validation.

## Examples

| File | Description |
|------|-------------|
| [`minimal.json`](./minimal.json) | Bare-minimum policy with just an identity block and a single allowed tool. Use this as a starting point or for simple agents. |
| [`full-guardrails.json`](./full-guardrails.json) | Policy with all guardrail types enabled: PII detection/redaction, content moderation (hate, violence, sexual, self-harm), prompt-injection protections, code execution sandboxing, rate limits, anomaly detection, and memory sanitisation. |
| [`budget-controlled.json`](./budget-controlled.json) | Policy with daily/hourly/monthly budget caps at both the identity and behavioral levels. Includes database query limits (table allow-listing, row caps) and rate limiting. |
| [`tool-restricted.json`](./tool-restricted.json) | Fine-grained tool access control — explicit allow/deny for file, database, code execution, network, and shell tools. Demonstrates `allowedTables`, `maxSize`, wildcard `forbidden` permissions, and domain-based network restrictions. |
| [`multi-model.json`](./multi-model.json) | Multi-model routing configuration with per-model rate limits, cost-per-token metadata, and fallback model declarations. Shows embedding tools alongside chat models from OpenAI, Anthropic, and Together. |

## Usage

```typescript
import { TealEngine } from 'tealtiger';
import policy from './examples/policies/full-guardrails.json';

const engine = new TealEngine(policy);
```

Or load at runtime:

```typescript
import { readFileSync } from 'fs';

const policy = JSON.parse(readFileSync('./examples/policies/minimal.json', 'utf-8'));
const engine = new TealEngine(policy);
```
