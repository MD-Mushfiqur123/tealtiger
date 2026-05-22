# TealEngine Policy Configuration

TealEngine policies are defined as JSON or YAML objects following the [TealEngine Policy JSON Schema](../schemas/tealengine-policy.json).

## Schema Location

The canonical JSON Schema is at `schemas/tealengine-policy.json` in the repository root.

You can reference it in your policy files:

```json
{
  "$schema": "https://raw.githubusercontent.com/agentguard-ai/tealtiger/main/schemas/tealengine-policy.json",
  "name": "my-policy",
  ...
}
```

## Top-Level Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Policy name |
| `description` | `string` | Human-readable description |
| `version` | `string` | Version identifier |
| `priority` | `integer` | Evaluation priority (higher = evaluated first) |
| `tools` | `object` | Tool permission configurations |
| `identity` | `object` | Agent identity configuration |
| `codeExecution` | `object` | Code execution controls |
| `behavioral` | `object` | Behavioral constraints (cost, rate, anomaly) |
| `guardrails` | `object` | Guardrail configurations (PII, content, injection) |
| `budget` | `object` | Simple budget settings |
| `budgets` | `array` | Named budget configurations |
| `rules` | `array` | Individual policy rules with conditions |
| `modelConfig` | `object` | Model-specific overrides |

## Examples

### Minimal policy

```json
{
  "tools": {
    "chat": { "allowed": true },
    "file_read": { "allowed": true, "maxSize": "10MB" },
    "file_write": { "allowed": false }
  },
  "identity": {
    "agentId": "my-agent",
    "role": "assistant",
    "permissions": ["read", "chat"],
    "forbidden": ["write", "delete"]
  }
}
```

### Full policy with guardrails and budget

```json
{
  "$schema": "https://raw.githubusercontent.com/agentguard-ai/tealtiger/main/schemas/tealengine-policy.json",
  "name": "production-guardrails",
  "description": "Production policy with all guardrails enabled",
  "version": "1.0.0",
  "priority": 10,

  "tools": {
    "chat": { "allowed": true },
    "search": { "allowed": true },
    "file_read": { "allowed": true, "maxSize": "10MB" },
    "code_execution": { "allowed": false }
  },

  "identity": {
    "agentId": "prod-agent",
    "role": "assistant",
    "permissions": ["read", "chat", "search"],
    "forbidden": ["write", "delete", "execute"]
  },

  "codeExecution": {
    "allowedLanguages": [],
    "blockedPatterns": ["eval", "exec", "system"],
    "requireSandbox": true
  },

  "behavioral": {
    "costLimit": { "daily": 50.00, "hourly": 10.00 },
    "rateLimit": { "requests": 500, "window": "1h" },
    "anomalyThreshold": 2.0
  },

  "guardrails": {
    "piiDetection": {
      "enabled": true,
      "action": "block",
      "detectTypes": ["email", "phone", "ssn", "creditCard"]
    },
    "contentModeration": {
      "enabled": true,
      "action": "block"
    },
    "promptInjection": {
      "enabled": true,
      "action": "block",
      "sensitivity": "high"
    }
  },

  "budget": {
    "maxCostPerRequest": 0.50,
    "maxCostPerDay": 10.00
  },

  "modelConfig": {
    "allowedModels": ["gpt-4", "gpt-4o", "claude-3-sonnet"],
    "maxTokensPerRequest": 4096,
    "allowedProviders": ["openai", "anthropic"]
  }
}
```

### Policy with rules

```json
{
  "rules": [
    {
      "name": "block-file-write-untrusted",
      "description": "Block file write for untrusted agents",
      "priority": 10,
      "condition": { "agentId": "untrusted-*", "toolName": "file-write" },
      "action": "deny",
      "reason": "Untrusted agents cannot write files"
    },
    {
      "name": "allow-web-search",
      "description": "Allow web search for all agents",
      "priority": 5,
      "condition": { "toolName": "web-search" },
      "action": "allow",
      "reason": "Web search is permitted"
    }
  ]
}
```
