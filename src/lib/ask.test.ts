// @ts-nocheck -- This file runs in Bun's test runtime, outside the browser bundle.
import { describe, expect, test } from 'bun:test';
import { answerQuestion, detectQuestion } from './ask';

const TODAY = '2026-10-12';
let id = 0;
function entry(transcript: string, fields: Record<string, unknown> = {}) {
	id += 1;
	return {
		id: `e${id}`,
		category: 'Note',
		title: transcript,
		detail: 'General timeline entry',
		when: '',
		transcript,
		time: '09:00',
		capturedAt: `${fields.day ?? TODAY}T07:00:00.000Z`,
		destination: 'Timeline',
		scheduledDate: fields.day,
		...fields
	};
}
const ask = (question: string, entries: unknown[]) => {
	const detected = detectQuestion(question);
	if (!detected) throw new Error(`Not a question: ${question}`);
	return answerQuestion(detected, entries, TODAY);
};

describe('recognising questions', () => {
	test('question forms are recognised', () => {
		expect(detectQuestion('Hvornår var jeg sidst hos tandlægen?')?.kind).toBe('last');
		expect(detectQuestion('hvornår var jeg sidst hos tandlægen')?.kind).toBe('last');
		expect(detectQuestion('When is my next dentist appointment')?.kind).toBe('next');
		expect(detectQuestion('Hvor står bilen')?.kind).toBe('where');
		expect(detectQuestion('Hvor er nøglerne')?.kind).toBe('where');
		expect(detectQuestion('Har jeg taget medicin i dag')?.kind).toBe('today');
		expect(detectQuestion('Hvad ved jeg om Anna')?.kind).toBe('about');
		expect(detectQuestion('Hvad mangler vi?')?.kind).toBe('list');
		expect(detectQuestion('Hvordan har min tinnitus været?')?.kind).toBe('trend');
		expect(detectQuestion('What did Anna say about the trip?')?.kind).toBe('search');
	});

	test('captures that start like questions stay captures', () => {
		expect(detectQuestion('Hvor er det dejligt vejr i dag')).toBeNull();
		expect(detectQuestion('Har ondt i hovedet')).toBeNull();
		expect(detectQuestion('Have dinner with Tom on Friday')).toBeNull();
		expect(detectQuestion('Hvad med middag fredag')).toBeNull();
		expect(detectQuestion('Mangler mælk')).toBeNull();
	});
});

describe('answers come from your own entries', () => {
	const entries = [
		entry('Tandlæge kl 10', { day: '2026-09-03', category: 'Reminder', destination: 'Calendar', scheduledTime: '10:00' }),
		entry('Tandlæge igen', { day: '2026-11-20', category: 'Reminder', destination: 'Calendar' }),
		entry('Bilen står på P-plads niveau 3', { day: '2026-10-11' }),
		entry('Tog medicin', { day: TODAY }),
		entry('Anna er allergisk over for nødder', { category: 'Person', person: 'Anna', people: ['Anna'], day: '2026-10-01' }),
		entry('Middag med Anna', { category: 'Social', people: ['Anna'], day: '2026-10-16', destination: 'Calendar' }),
		entry('Tinnitus 6', { category: 'Wellbeing', wellbeingScore: 6, day: '2026-10-11' }),
		entry('Tinnitus 4', { category: 'Wellbeing', wellbeingScore: 4, day: '2026-10-09' }),
		entry('Tinnitus 7', { category: 'Wellbeing', wellbeingScore: 7, day: '2026-10-02' }),
		entry('Mælk', { category: 'Shopping', destination: 'List', status: 'Planned' }),
		entry('Æg', { category: 'Shopping', destination: 'List', status: 'Completed' })
	];

	test('when last: the most recent past match, with how long ago', () => {
		const answer = ask('Hvornår var jeg sidst hos tandlægen?', entries);
		expect(answer.summary).toContain('39 days ago');
		expect(answer.entries[0].transcript).toBe('Tandlæge kl 10');
	});

	test('when next: the nearest future match', () => {
		const answer = ask('Hvornår skal jeg til tandlæge næste gang?', entries);
		expect(answer.entries[0].transcript).toBe('Tandlæge igen');
		expect(answer.summary).toContain('in 39 days');
	});

	test('where: the latest mention', () => {
		expect(ask('Hvor står bilen?', entries).summary).toContain('P-plads niveau 3');
	});

	test('today: yes, or when it last happened', () => {
		expect(ask('Har jeg taget medicin i dag?', entries).summary).toMatch(/^Yes/);
		expect(ask('Har jeg været hos tandlægen i dag?', entries).summary).toMatch(/^Not today\. Last time/);
	});

	test('about a person: notes and plans together', () => {
		const answer = ask('Hvad ved jeg om Anna?', entries);
		expect(answer.summary).toContain('1 note about Anna');
		expect(answer.summary).toContain('Next together');
		expect(answer.entries.map((item) => item.transcript)).toContain('Anna er allergisk over for nødder');
		expect(ask('Hvad ved jeg om Mads?', entries).summary).toContain('Om Mads');
	});

	test('the shopping list lists only what is left to buy', () => {
		const answer = ask('Hvad mangler vi?', entries);
		expect(answer.summary).toBe('1 to buy: Mælk.');
	});

	test('a score trend compares the last 7 days with the week before', () => {
		const answer = ask('Hvordan har min tinnitus været?', entries);
		expect(answer.kind).toBe('trend');
		expect(answer.summary).toContain('5 / 10 on average over the last 7 days (2 scores)');
		expect(answer.summary).toContain('down from 7 the week before');
	});

	test('says so when nothing matches', () => {
		expect(ask('Hvornår var jeg sidst i svømmehallen?', entries).summary).toContain('Nothing in your traces matches');
	});
});

describe('small words', () => {
	test('do not need to match', () => {
		const answer = answerQuestion(detectQuestion('Hvornår var jeg sidst hos frisøren?'), [entry('Frisør 14/10', { day: '2026-10-05' })], TODAY);
		expect(answer.partial).toBe(false);
	});
});
