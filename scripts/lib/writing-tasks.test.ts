import { describe, expect, it } from 'vitest';
import { TaskParseError, parseTaskFile, splitFrontMatter, splitSections } from './writing-tasks';

const VALID = `---
taskNumber: 1
title: Message à un ami
minWords: 60
maxWords: 120
---
Répondez en respectant le nombre de mots.

## Prompt
Un ami vous demande des conseils sur les transports. Répondez-lui.

## Sample answer
Salut Pierre, …

## Template
- Salutation
- Recommandation
`;

describe('splitFrontMatter', () => {
  it('parses key: value pairs and returns the body', () => {
    const { yaml, body } = splitFrontMatter(VALID);
    expect(yaml.taskNumber).toBe('1');
    expect(yaml.title).toBe('Message à un ami');
    expect(body).toContain('## Prompt');
  });

  it('throws when the front-matter fence is missing', () => {
    expect(() => splitFrontMatter('no front matter here')).toThrow(TaskParseError);
  });

  it('throws when the front-matter fence is unterminated', () => {
    expect(() => splitFrontMatter('---\ntaskNumber: 1\nstill going')).toThrow(TaskParseError);
  });
});

describe('splitSections', () => {
  it('separates leading instructions from ## sections', () => {
    const { instructions, sections } = splitSections(
      'Do the thing.\n\n## Prompt\nWrite a message.\n\n## Template\n- a\n- b',
    );
    expect(instructions).toBe('Do the thing.');
    expect(sections.get('prompt')).toBe('Write a message.');
    expect(sections.get('template')).toBe('- a\n- b');
  });
});

describe('parseTaskFile', () => {
  it('parses a complete, valid task file', () => {
    const task = parseTaskFile(VALID);
    expect(task).toEqual({
      taskNumber: 1,
      title: 'Message à un ami',
      prompt: 'Un ami vous demande des conseils sur les transports. Répondez-lui.',
      instructions: 'Répondez en respectant le nombre de mots.',
      minWords: 60,
      maxWords: 120,
      sampleAnswer: 'Salut Pierre, …',
      template: '- Salutation\n- Recommandation',
    });
  });

  it('treats sample answer and template as optional', () => {
    const task = parseTaskFile('---\ntaskNumber: 2\n---\n## Prompt\nDécrivez un événement.');
    expect(task.sampleAnswer).toBeNull();
    expect(task.template).toBeNull();
    expect(task.minWords).toBeNull();
  });

  it('rejects a missing or out-of-range taskNumber', () => {
    expect(() => parseTaskFile('---\ntitle: x\n---\n## Prompt\nHi')).toThrow(/taskNumber/);
    expect(() => parseTaskFile('---\ntaskNumber: 4\n---\n## Prompt\nHi')).toThrow(/between 1 and 3/);
  });

  it('rejects a missing or empty ## Prompt', () => {
    expect(() => parseTaskFile('---\ntaskNumber: 1\n---\nno prompt section')).toThrow(/Prompt/);
    expect(() => parseTaskFile('---\ntaskNumber: 1\n---\n## Prompt\n   ')).toThrow(/Prompt/);
  });

  it('rejects non-integer word counts', () => {
    expect(() => parseTaskFile('---\ntaskNumber: 1\nminWords: lots\n---\n## Prompt\nHi')).toThrow(
      /minWords/,
    );
  });
});
