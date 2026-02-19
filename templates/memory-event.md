---
primitive: memory_event
description: Canonical schema for append-only observer memory events.
fields:
  type:
    type: string
    required: true
    default: memory_event
    description: Primitive discriminator for memory events.
  status:
    type: string
    required: true
    default: recorded
    enum:
      - recorded
      - superseded
      - corrected
    description: Memory event lifecycle state.
  created:
    type: datetime
    required: true
    default: "{{datetime}}"
    description: Event ingestion timestamp.
  observed_at:
    type: datetime
    required: true
    description: Source session timestamp for observed behavior.
  source:
    type: string
    required: true
    enum:
      - openclaw
      - claude-code
      - replay
      - manual-correction
    description: Event source channel.
  session_id:
    type: string
    description: Runtime session identifier.
  continuity_event:
    type: string
    enum:
      - none
      - new
      - reset
    default: none
    description: Continuity marker for /new or /reset transitions.
  confidence:
    type: number
    description: Confidence score for extracted event.
  importance:
    type: number
    description: Importance score used by promotion and retrieval.
  run_id:
    type: string
    description: Related run primitive identifier.
  summary:
    type: string
    required: true
    description: Structured summary of the observed memory event.
---

# {{title}}

{{links_line}}

{{content}}
