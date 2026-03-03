import { describe, expect, it, beforeAll } from 'vitest';
import {
  classifyText, getSchema, getAllSchemas, getSchemaNames,
  generateFrontmatter, validateFrontmatter, serializeFrontmatter,
  parseYamlFrontmatter, initializeTemplateRegistry,
} from './templates.js';

beforeAll(() => {
  // Initialize template registry (may load from CWD templates/ or use defaults)
  initializeTemplateRegistry();
});

describe('parseYamlFrontmatter', () => {
  it('parses basic frontmatter', () => {
    const result = parseYamlFrontmatter('---\ntitle: Test\ntype: memory_event\n---\nBody content');
    expect(result).not.toBeNull();
    expect(result?.frontmatter.title).toBe('Test');
    expect(result?.frontmatter.type).toBe('memory_event');
    expect(result?.body).toBe('Body content');
  });

  it('returns null for no frontmatter', () => {
    expect(parseYamlFrontmatter('Just some text')).toBeNull();
  });

  it('handles boolean values', () => {
    const result = parseYamlFrontmatter('---\nactive: true\ndone: false\n---\n');
    expect(result?.frontmatter.active).toBe(true);
    expect(result?.frontmatter.done).toBe(false);
  });

  it('handles numeric values', () => {
    const result = parseYamlFrontmatter('---\ncount: 42\nscore: 3.14\n---\n');
    expect(result?.frontmatter.count).toBe(42);
    expect(result?.frontmatter.score).toBe(3.14);
  });

  it('handles null values', () => {
    const result = parseYamlFrontmatter('---\nvalue: null\ntilde: ~\n---\n');
    expect(result?.frontmatter.value).toBeNull();
    expect(result?.frontmatter.tilde).toBeNull();
  });
});

describe('classifyText', () => {
  it('classifies preferences as memory_event', () => {
    const result = classifyText('I prefer using TypeScript over JavaScript');
    expect(result.primitiveType).toBe('memory_event');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies decisions', () => {
    const result = classifyText('We decided to use PostgreSQL for the database');
    expect(result.primitiveType).toBe('decision');
  });

  it('classifies people/contact info', () => {
    const result = classifyText('John works at Google and his email is john@google.com');
    expect(result.primitiveType).toBe('person');
  });

  it('classifies tasks with deadlines', () => {
    const result = classifyText('This needs to be done by tomorrow with the deadline approaching');
    expect(result.primitiveType).toBe('task');
  });

  it('classifies lessons', () => {
    const result = classifyText('I learned that caching reduces latency significantly');
    expect(result.primitiveType).toBe('lesson');
  });

  it('returns a primitive type for ambiguous text', () => {
    const result = classifyText('The weather is nice today');
    // May be memory_event or daily-note depending on templates loaded
    expect(typeof result.primitiveType).toBe('string');
    expect(result.confidence).toBeDefined();
  });

  it('returns matched keywords', () => {
    const result = classifyText('I like pizza and I prefer dark mode');
    expect(result.matchedKeywords.length).toBeGreaterThan(0);
  });
});

describe('getSchema / getAllSchemas / getSchemaNames', () => {
  it('returns schema for known primitives', () => {
    // When running from repo, templates/ dir provides schemas
    const schemas = getAllSchemas();
    expect(schemas.length).toBeGreaterThanOrEqual(1);
    // At least one schema should be defined
    const names = getSchemaNames();
    expect(names.length).toBeGreaterThan(0);
  });

  it('returns undefined for unknown primitives', () => {
    expect(getSchema('nonexistent_xyz_123')).toBeUndefined();
  });

  it('getAllSchemas returns multiple schemas', () => {
    const schemas = getAllSchemas();
    expect(schemas.length).toBeGreaterThanOrEqual(1);
  });

  it('getSchemaNames returns names', () => {
    const names = getSchemaNames();
    expect(names.length).toBeGreaterThan(0);
    // Every schema should have a primitive field
    for (const schema of getAllSchemas()) {
      expect(schema.primitive).toBeTruthy();
    }
  });
});

describe('generateFrontmatter', () => {
  it('generates frontmatter with type field', () => {
    const fm = generateFrontmatter('memory_event');
    // Will have type or created depending on loaded schemas
    expect(fm).toBeDefined();
    expect(typeof fm).toBe('object');
  });

  it('applies title substitution when schema has title field', () => {
    const fm = generateFrontmatter('person', { title: 'John Doe' });
    // If schema has title field, it should be substituted
    if (getSchema('person')?.fields.title) {
      expect(fm.title).toBe('John Doe');
    }
  });

  it('applies extra fields when schema has matching fields', () => {
    const schema = getSchema('memory_event');
    if (schema?.fields.confidence) {
      const fm = generateFrontmatter('memory_event', {
        extraFields: { confidence: 0.9 },
      });
      expect(fm.confidence).toBe(0.9);
    }
  });

  it('generates fallback for unknown primitives', () => {
    const fm = generateFrontmatter('unknown_type_xyz_999');
    expect(fm.type).toBe('unknown_type_xyz_999');
    expect(fm.created).toBeDefined();
  });
});

describe('validateFrontmatter', () => {
  it('validates correct generated frontmatter', () => {
    // Generate frontmatter and fill all required fields
    const schema = getSchema('memory_event');
    if (schema) {
      const fm = generateFrontmatter('memory_event');
      // Fill any remaining required fields
      for (const [name, def] of Object.entries(schema.fields)) {
        if (def.required && (fm[name] === undefined || fm[name] === '')) {
          if (def.type === 'string') fm[name] = 'test';
          else if (def.type === 'datetime') fm[name] = new Date().toISOString();
          else if (def.type === 'date') fm[name] = '2025-01-01';
          else if (def.type === 'number') fm[name] = 1;
        }
      }
      const result = validateFrontmatter('memory_event', fm);
      expect(result.valid).toBe(true);
    }
  });

  it('detects missing required fields when schema exists', () => {
    const schema = getSchema('memory_event');
    if (schema) {
      const result = validateFrontmatter('memory_event', {});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('passes for unknown primitives', () => {
    const result = validateFrontmatter('unknown_xyz_999', {});
    expect(result.valid).toBe(true);
  });
});

describe('serializeFrontmatter', () => {
  it('serializes basic key-value pairs', () => {
    const result = serializeFrontmatter({ title: 'Test', count: 42 });
    expect(result).toContain('---');
    expect(result).toContain('title: Test');
    expect(result).toContain('count: 42');
  });

  it('serializes arrays', () => {
    const result = serializeFrontmatter({ tags: ['a', 'b', 'c'] });
    expect(result).toContain('tags:');
    expect(result).toContain('  - a');
    expect(result).toContain('  - b');
  });

  it('skips null/undefined values', () => {
    const result = serializeFrontmatter({ title: 'Test', empty: null, undef: undefined });
    expect(result).not.toContain('empty');
    expect(result).not.toContain('undef');
  });
});
