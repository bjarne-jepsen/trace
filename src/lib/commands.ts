import type { EntryCategory } from './entry';

/** Categories a command word can choose. Person notes have their own "Om Anna: …" form. */
export type CommandCategory = Extract<EntryCategory, 'Wellbeing' | 'Habit' | 'Reminder' | 'Social' | 'Place' | 'Note' | 'Shopping'>;

export type CommandWord = { word: string; category: CommandCategory };

export const COMMAND_CATEGORIES: CommandCategory[] = ['Wellbeing', 'Habit', 'Reminder', 'Social', 'Place', 'Note', 'Shopping'];

/** What a number right after the word means. Fixed per category, so there is nothing extra to configure. */
export function commandNumberMeaning(category: CommandCategory) {
	return category === 'Wellbeing' ? 'score' : category === 'Habit' ? 'minutes' : 'none';
}

export const DEFAULT_COMMANDS: CommandWord[] = [
	{ word: 'Tinnitus', category: 'Wellbeing' },
	{ word: 'Søvn', category: 'Wellbeing' },
	{ word: 'Humør', category: 'Wellbeing' },
	{ word: 'Løb', category: 'Habit' },
	{ word: 'Træning', category: 'Habit' },
	{ word: 'Note', category: 'Note' },
	{ word: 'Sted', category: 'Place' }
];

const key = (word: string) => word.trim().toLocaleLowerCase('da-DK');

/** Accepts stored or restored data only when every command is well formed. */
export function normalizeCommands(value: unknown): CommandWord[] | null {
	if (!Array.isArray(value)) return null;
	const commands: CommandWord[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') return null;
		const { word, category } = item as Record<string, unknown>;
		if (typeof word !== 'string' || !COMMAND_CATEGORIES.includes(category as CommandCategory)) return null;
		if (commandProblem(word, commands)) continue;
		commands.push({ word: word.trim(), category: category as CommandCategory });
	}
	return commands;
}

export function commandProblem(word: string, commands: CommandWord[]) {
	const trimmed = word.trim();
	if (!trimmed) return 'Type a word.';
	if (trimmed.length > 30) return 'Keep it under 30 characters.';
	if (!/^[\p{L}][\p{L}' -]*$/u.test(trimmed)) return 'Use letters only.';
	if (commands.some((command) => key(command.word) === key(trimmed))) return `“${trimmed}” is already a command word.`;
	return '';
}

/** A command only counts as the first word(s) of a capture, so the same word inside a sentence means nothing special. */
export function matchCommand(text: string, commands: CommandWord[]) {
	const lower = text.trimStart().toLocaleLowerCase('da-DK');
	const command = [...commands]
		.sort((left, right) => right.word.length - left.word.length)
		.find((candidate) => {
			const word = key(candidate.word);
			return lower.startsWith(word) && /^(?:$|[\s:,.–—-])/u.test(lower.slice(word.length));
		});
	if (!command) return null;
	const rest = text.trimStart().slice(command.word.trim().length).replace(/^[\s:,.–—-]+/u, '').trim();
	return { command, rest };
}
