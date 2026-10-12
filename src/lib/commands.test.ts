// @ts-nocheck -- This file runs in Bun's test runtime, outside the browser bundle.
import { describe, expect, test } from 'bun:test';
import { DEFAULT_COMMANDS, commandProblem, matchCommand, normalizeCommands } from './commands';

describe('command words', () => {
	test('reject empty, duplicate and non-letter words', () => {
		expect(commandProblem('', DEFAULT_COMMANDS)).not.toBe('');
		expect(commandProblem('tinnitus', DEFAULT_COMMANDS)).toContain('already');
		expect(commandProblem('Run5', DEFAULT_COMMANDS)).not.toBe('');
		expect(commandProblem('Medicin', DEFAULT_COMMANDS)).toBe('');
	});

	test('restored data must be well formed', () => {
		expect(normalizeCommands('nope')).toBeNull();
		expect(normalizeCommands([{ word: 'X', category: 'Unknown' }])).toBeNull();
		expect(normalizeCommands([{ word: 'Yoga', category: 'Habit' }, { word: 'yoga', category: 'Note' }])).toEqual([
			{ word: 'Yoga', category: 'Habit' }
		]);
	});

	test('match the first word with optional punctuation, not a longer word', () => {
		expect(matchCommand('Løb: 30', DEFAULT_COMMANDS)?.rest).toBe('30');
		expect(matchCommand('løb 30', DEFAULT_COMMANDS)?.command.word).toBe('Løb');
		expect(matchCommand('Løbetur 30', DEFAULT_COMMANDS)).toBeNull();
	});
});
