---
primitive: workspace
description: Canonical schema for a shared ClawVault workspace.
fields:
  type:
    type: string
    required: true
    default: workspace
    description: Primitive discriminator for workspace documents.
  status:
    type: string
    required: true
    default: active
    enum:
      - active
      - paused
      - archived
    description: Workspace lifecycle state.
  created:
    type: datetime
    required: true
    default: "{{datetime}}"
    description: ISO timestamp when the workspace was created.
  updated:
    type: datetime
    required: true
    default: "{{datetime}}"
    description: ISO timestamp when the workspace was last updated.
  owner:
    type: string
    description: Primary workspace owner.
  parties:
    type: string[]
    description: Related party slugs.
  policy_profile:
    type: string
    description: Default policy profile for automation.
  tags:
    type: string[]
    description: Labels used for filtering.
  description:
    type: string
    description: One-line summary of workspace intent.
---

# {{title}}

{{links_line}}

{{content}}
