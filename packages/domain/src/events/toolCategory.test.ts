import { describe, expect, it } from 'vitest';
import { classifyTool, toolTarget } from './toolCategory';

describe('classifyTool', () => {
  it.each([
    ['Read', undefined, 'read'],
    ['Grep', undefined, 'search'],
    ['Edit', undefined, 'write'],
    ['Write', undefined, 'write'],
    ['Task', undefined, 'delegate'],
    ['Agent', undefined, 'delegate'],
    ['TodoWrite', undefined, 'plan'],
    ['WebFetch', undefined, 'web'],
    ['Bash', { command: 'npm test' }, 'test'],
    ['Bash', { command: 'cargo build --release' }, 'test'],
    ['Bash', { command: 'ls -la' }, 'execute'],
    ['mcp__github__create_issue', undefined, 'other'],
  ] as const)('%s -> %s', (tool, input, expected) => {
    expect(classifyTool(tool, input)).toBe(expected);
  });
});

describe('toolTarget', () => {
  it('prefers file paths and truncates', () => {
    expect(toolTarget('Read', { file_path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(toolTarget('Bash', { command: 'x'.repeat(200) }, 10)).toHaveLength(10);
  });
  it('ignores non-objects', () => {
    expect(toolTarget('Read', 'nope')).toBeUndefined();
  });
});
