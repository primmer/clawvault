---
primitive: run
description: Canonical schema for task/project run executions.
fields:
  type:
    type: string
    required: true
    default: run
    description: Primitive discriminator for run documents.
  status:
    type: string
    required: true
    default: queued
    enum:
      - queued
      - running
      - succeeded
      - failed
      - cancelled
    description: Run lifecycle state.
  created:
    type: datetime
    required: true
    default: "{{datetime}}"
    description: ISO timestamp when the run was created.
  updated:
    type: datetime
    required: true
    default: "{{datetime}}"
    description: ISO timestamp of the latest run update.
  started:
    type: datetime
    description: Timestamp when execution started.
  finished:
    type: datetime
    description: Timestamp when execution ended.
  trigger_id:
    type: string
    description: Trigger primitive that initiated this run.
  task_id:
    type: string
    description: Task primitive associated with the run.
  project:
    type: string
    description: Related project slug.
  owner:
    type: string
    description: Run owner.
  actor:
    type: string
    description: Runtime actor responsible for execution.
  idempotency_key:
    type: string
    required: true
    description: Idempotency key used to guarantee exactly-once semantics.
  result:
    type: string
    description: Human-readable result summary.
  error:
    type: string
    description: Error summary when status is failed.
---

# {{title}}

{{links_line}}

{{content}}
