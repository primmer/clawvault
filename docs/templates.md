# Templates Guide

Templates define the schema for each type of memory primitive. They control what fields a document has, which are required, and what values are allowed.

## How Templates Work

Every template is a markdown file with YAML frontmatter in `templates/`. When ClawVault creates a document, it reads the matching template to determine the schema.

```
templates/
  task.md          # Task schema
  decision.md      # Decision schema
  lesson.md        # Lesson schema
  person.md        # Person/contact schema
  project.md       # Project schema
  ...
```

## Default Templates

ClawVault ships with these built-in templates:

| Template | Description |
|----------|-------------|
| `task` | Work items with status, priority, owner, due date |
| `decision` | Recorded decisions with context and rationale |
| `lesson` | Learned lessons from experience |
| `person` | People and contacts |
| `project` | Project containers that group tasks |
| `checkpoint` | Session state snapshots for context-death resilience |
| `handoff` | Session handoff documents |
| `daily` | Daily notes |
| `daily-note` | Daily observation notes |
| `trigger` | Automated triggers |
| `run` | Execution run records |
| `party` | Multi-agent collaboration parties |
| `workspace` | Workspace configuration |
| `memory-event` | Observed memory events |

## Template Anatomy

```yaml
---
primitive: task
fields:
  status:
    type: string
    required: true
    default: open
    enum: [open, in-progress, blocked, done]
  priority:
    type: string
    enum: [critical, high, medium, low]
  owner:
    type: string
  due:
    type: date
  project:
    type: string
  tags:
    type: array
---
```

### Field Types

| Type | Description | Example |
|------|-------------|---------|
| `string` | Text value | `"Deploy to prod"` |
| `number` | Numeric value | `42` |
| `boolean` | True/false | `true` |
| `date` | ISO date | `2026-02-19` |
| `array` | List of values | `[tag1, tag2]` |

### Field Options

| Option | Description |
|--------|-------------|
| `type` | Field type (required) |
| `required` | Whether the field must be present |
| `default` | Default value if not specified |
| `enum` | Allowed values |

## Customizing Templates

### Override a Default Template

Create a file with the same name in your vault's `templates/` directory:

```bash
# Your vault
~/my-vault/
  templates/
    task.md    # YOUR schema — overrides the default
```

Your template takes priority over the built-in one.

### Add New Primitive Types

Create a new template file:

```yaml
---
primitive: meeting
fields:
  attendees:
    type: array
    required: true
  date:
    type: date
    required: true
  action_items:
    type: array
  summary:
    type: string
  project:
    type: string
---
```

Save as `templates/meeting.md` in your vault. The plugin will automatically recognize and use it.

### Remove Fields

Override the default template with fewer fields:

```yaml
---
primitive: task
fields:
  status:
    type: string
    required: true
    default: open
    enum: [open, done]
  title:
    type: string
    required: true
---
```

## Template Discovery

The plugin reads templates on boot in this order:

1. **Vault templates** (`<vault>/templates/`) — highest priority
2. **Package templates** (`clawvault/templates/`) — defaults

Vault templates override package templates with the same name.

## Primitive Registry

The `primitive-registry.yaml` file defines all known primitive types and their relationships. It's used for graph navigation and cross-referencing.

## CLI Template Management

```bash
# List available templates
clawvault template list

# Show a template's schema
clawvault template show task

# Validate templates
clawvault doctor
```
