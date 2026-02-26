---
primitive: trigger
description: Canonical schema for run trigger definitions.
fields:
  type:
    type: string
    required: true
    default: trigger
    description: Primitive discriminator for trigger documents.
  status:
    type: string
    required: true
    default: active
    enum:
      - active
      - paused
      - archived
    description: Trigger lifecycle state.
  created:
    type: datetime
    required: true
    default: "{{datetime}}"
    description: ISO timestamp when trigger was created.
  updated:
    type: datetime
    required: true
    default: "{{datetime}}"
    description: ISO timestamp when trigger was last updated.
  trigger_type:
    type: string
    required: true
    enum:
      - manual
      - schedule
      - event
    description: Trigger activation mode.
  target:
    type: string
    required: true
    description: Target task or project identifier.
  owner:
    type: string
    description: Trigger owner.
  idempotency_scope:
    type: string
    required: true
    default: per-target
    enum:
      - per-target
      - global
      - windowed
    description: Strategy for idempotency key uniqueness.
  policy_profile:
    type: string
    description: Policy profile required for trigger execution.
  schedule:
    type: string
    description: Optional cron expression for scheduled triggers.
  description:
    type: string
    description: One-line trigger summary.
---

# {{title}}

{{links_line}}

{{content}}
