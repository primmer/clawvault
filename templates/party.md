---
primitive: party
description: Canonical schema for parties (humans, agents, systems).
fields:
  type:
    type: string
    required: true
    default: party
    description: Primitive discriminator for party documents.
  status:
    type: string
    required: true
    default: active
    enum:
      - active
      - inactive
      - archived
    description: Party lifecycle state.
  created:
    type: datetime
    required: true
    default: "{{datetime}}"
    description: ISO timestamp when party was added.
  updated:
    type: datetime
    required: true
    default: "{{datetime}}"
    description: ISO timestamp of the latest update.
  party_type:
    type: string
    required: true
    enum:
      - human
      - agent
      - runtime
      - service
    description: Role classification.
  handle:
    type: string
    required: true
    description: Primary identifier for routing and ownership.
  owner:
    type: string
    description: Owner or steward for this party entry.
  capabilities:
    type: string[]
    description: Capability tags used for assignment.
  runtime:
    type: string
    description: Runtime name when party_type is agent/runtime.
  policy_profile:
    type: string
    description: Policy profile applied to this party.
  description:
    type: string
    description: One-line party summary.
---

# {{title}}

{{links_line}}

{{content}}
