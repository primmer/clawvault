# @clawvault/sdk-demo

Demo SDK package for programmatic `workgraph` CLI orchestration.

This package intentionally stays lightweight and JSON-first so agents can:

- run `workgraph` commands with deterministic JSON parsing
- compose a reusable SDK client (`DemoWorkgraphSdk`)
- script skill lifecycle and ledger checks in code

## Install

```bash
npm install @clawvault/sdk-demo
```

## Example

```ts
import { DemoWorkgraphSdk } from '@clawvault/sdk-demo';

const sdk = new DemoWorkgraphSdk('/tmp/workspace', 'agent-a');
await sdk.init();
await sdk.writeSkill('workgraph-manual', '# guide');
await sdk.proposeSkill('workgraph-manual');
await sdk.promoteSkill('workgraph-manual');
```
