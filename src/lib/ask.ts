import type { TimelineEntry } from './entry';
import { localDateKey, parseDateKey, relativeDayLabel } from './dates';
import { entryDateKey, wellbeingScoreOf } from './timeline';

export type QuestionKind = 'last' | 'next' | 'where' | 'about' | 'today' | 'list' | 'trend' | 'search';
export type Question = { kind: QuestionKind; text: string; terms: string[]; subject: string };
export type Answer = {
	kind: QuestionKind;
	summary: string;
	entries: TimelineEntry[];
	/** True when no entry matched every word and the entries are only the closest ones. */
	partial?: boolean;
	shopping?: TimelineEntry[];
};

// Question words, helper verbs and time words carry no content to search for.
const STOP_WORDS = new Set(
	`hvornår hvor hvad hvem hvilken hvilket hvilke hvordan var jeg vi du han hun de det den der som har havde er skal kan
	sidst senest sidste næste igen gang gange dag idag på til om med for at en et min mit mine vores din dit dine sin sit sine
	ved og eller lagde står stod ligger lå satte parkerede gemte købe mangler taget tog været fået fik gjort gjorde nogensinde
	mig fortæl egentlig så hos af fra ude inde hjemme
	when where what who which how did do does was were is are am have has had i we you my our your the a an to at on in for of
	last next again time times today ever been put leave left park parked keep kept know about tell me get got go went take took with from`
		.split(/\s+/)
		.filter(Boolean)
);

const STEM_SUFFIXES = ['erne', 'ende', 'ede', 'ene', 'ing', 'er', 'en', 'et', 'ne', 'ed', 'e', 's'];

function stem(word: string) {
	for (const suffix of STEM_SUFFIXES) {
		if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0, -suffix.length);
	}
	return word;
}

function words(text: string) {
	return text
		.toLocaleLowerCase('da-DK')
		.split(/[^\p{L}\d]+/u)
		.filter(Boolean);
}

export function searchTerms(text: string) {
	return [...new Set(words(text).filter((word) => word.length > 1 && !STOP_WORDS.has(word)).map(stem))];
}

const capitalize = (value: string) => (value ? value[0].toLocaleUpperCase('da-DK') + value.slice(1) : value);

/**
 * Recognises a question by how it starts. Captures and questions share one input, so only clear question forms
 * count: "Hvornår …", "Hvor står/ligger/lagde …", "Har jeg …", "Hvad ved jeg om …", "Hvad mangler vi?".
 */
export function detectQuestion(input: string): Question | null {
	const text = input.trim();
	const lower = text.toLocaleLowerCase('da-DK');
	const asked = /\?\s*$/.test(text);
	const question = (kind: QuestionKind, subject = text): Question => ({ kind, text, subject: subject.trim(), terms: searchTerms(subject) });

	if (/^(?:hvad\s+(?:mangler\s+vi|står\s+på\s+(?:indkøbs)?listen|skal\s+(?:vi|jeg)\s+købe)|what\s+(?:do\s+we\s+need|(?:is|'s)\s+on\s+the\s+(?:shopping\s+)?list|should\s+i\s+buy))\b/i.test(lower)) {
		return question('list', '');
	}
	const about = text.match(/^(?:hvad\s+ved\s+jeg\s+om|fortæl\s+(?:mig\s+)?om|what\s+do\s+i\s+know\s+about|tell\s+me\s+about)\s+(.+?)\s*\??$/i);
	if (about) return question('about', about[1]);
	const trend = text.match(/^(?:hvordan\s+(?:har|er)\s+(?:min\s+|mit\s+|mine\s+)?(.+?)(?:\s+været)?(?:\s+(?:på\s+det\s+sidste|for\s+nylig|i\s+det\s+sidste\s+stykke\s+tid))?\s*\??|how\s+(?:has|have|is|are)\s+(?:my\s+)?(.+?)(?:\s+been)?(?:\s+lately|\s+recently)?\s*\??)$/i);
	if (trend) return question('trend', trend[1] ?? trend[2] ?? '');
	if (/^(?:hvornår|when)\b/i.test(lower)) {
		if (/\b(?:sidst|senest|last)\b/i.test(lower)) return question('last');
		if (/\b(?:næste|next|igen)\b/i.test(lower) || /^(?:hvornår\s+(?:skal|er)|when\s+(?:is|am|are|do\s+i\s+have|will|should))\b/i.test(lower)) {
			return question('next');
		}
		return question('last');
	}
	if (
		/^(?:hvor\s+(?:står|stod|ligger|lå|lagde|satte|parkerede|gemte|har\s+jeg\s+(?:lagt|sat|parkeret|gemt))|where\s+(?:is|are|did|was|were|'s|do|have))\b/i.test(lower) ||
		/^hvor\s+er\s+(?:min|mit|mine|vores|(?!det\b|den\b|de\b)\p{L}+(?:en|et|ne))\b/iu.test(lower) ||
		(asked && /^hvor\s+er\b/i.test(lower))
	) {
		return question('where');
	}
	if (/^(?:har\s+jeg|have\s+i|did\s+i)\b/i.test(lower)) return question('today');
	if (asked && /^(?:hvad|hvem|hvilk\p{L}*|what|who|which)\b/iu.test(lower)) return question('search');
	return null;
}

function searchableText(entry: TimelineEntry) {
	return [entry.transcript, entry.title, entry.detail, entry.person, entry.people?.join(' '), entry.placeAddress, entry.category]
		.filter(Boolean)
		.join(' ');
}

function matchCount(entry: TimelineEntry, terms: string[]) {
	const stems = words(searchableText(entry)).map(stem);
	return terms.filter((term) => stems.some((word) => word.startsWith(term) || (word.length >= 3 && term.startsWith(word)))).length;
}

function sortKey(entry: TimelineEntry) {
	return `${entryDateKey(entry)}T${entry.scheduledTime || entry.time || '00:00'}|${entry.capturedAt}`;
}

/** Entries that match every search word, or, failing that, the ones that match the most words. */
function findMatches(entries: TimelineEntry[], terms: string[]) {
	if (!terms.length) return { matches: [] as TimelineEntry[], partial: false };
	const scored = entries.map((entry) => ({ entry, count: matchCount(entry, terms) })).filter((item) => item.count > 0);
	const best = Math.max(0, ...scored.map((item) => item.count));
	return {
		matches: scored.filter((item) => item.count === best).map((item) => item.entry),
		partial: best > 0 && best < terms.length
	};
}

function daysBetween(fromKey: string, toKey: string) {
	return Math.round((parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) / 86400000);
}

function when(entry: TimelineEntry, todayKey: string) {
	const key = entryDateKey(entry);
	const time = entry.scheduledTime || (entry.scheduledDate ? '' : entry.time);
	return `${relativeDayLabel(key, todayKey)}${time ? ` at ${time}` : ''}`;
}

function ago(key: string, todayKey: string) {
	const days = daysBetween(key, todayKey);
	return days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 0 ? `in ${-days} days` : `${days} days ago`;
}

function average(values: number[]) {
	return values.reduce((total, value) => total + value, 0) / values.length;
}

const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** Answers from the user's own entries only. Nothing is sent anywhere and the same data gives the same answer. */
export function answerQuestion(question: Question, timeline: TimelineEntry[], todayKey: string): Answer {
	const traces = timeline.filter((entry) => entry.destination !== 'List');
	const newestFirst = (list: TimelineEntry[]) => [...list].sort((left, right) => sortKey(right).localeCompare(sortKey(left)));
	const oldestFirst = (list: TimelineEntry[]) => [...list].sort((left, right) => sortKey(left).localeCompare(sortKey(right)));
	const topic = question.terms.length ? `“${question.subject.replace(/\?$/, '')}”` : 'that';

	if (question.kind === 'list') {
		const open = timeline.filter((entry) => entry.destination === 'List' && entry.status !== 'Completed');
		return {
			kind: 'list',
			summary: open.length ? `${open.length} to buy: ${open.map((entry) => entry.title).join(', ')}.` : 'The shopping list is empty.',
			entries: [],
			shopping: open
		};
	}

	if (question.kind === 'about') {
		const name = capitalize(question.subject);
		const key = name.toLocaleLowerCase('da-DK');
		const notes = newestFirst(traces.filter((entry) => entry.category === 'Person' && entry.person?.toLocaleLowerCase('da-DK') === key));
		const together = newestFirst(
			traces.filter((entry) => entry.category !== 'Person' && entry.people?.some((person) => person.toLocaleLowerCase('da-DK') === key))
		);
		const next = oldestFirst(together.filter((entry) => entryDateKey(entry) >= todayKey))[0];
		const last = together.find((entry) => entryDateKey(entry) < todayKey);
		const parts = [
			notes.length ? `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} about ${name}.` : `No notes about ${name} yet. Say “Om ${name}: …” to add one.`,
			next ? `Next together: ${when(next, todayKey)}.` : '',
			last ? `Last together: ${relativeDayLabel(entryDateKey(last), todayKey)}.` : ''
		];
		return { kind: 'about', summary: parts.filter(Boolean).join(' '), entries: [...notes.slice(0, 5), ...(next ? [next] : []), ...(last ? [last] : [])] };
	}

	const { matches, partial } = findMatches(traces, question.terms);
	const past = newestFirst(matches.filter((entry) => entryDateKey(entry) <= todayKey));
	const future = oldestFirst(matches.filter((entry) => entryDateKey(entry) > todayKey || (entryDateKey(entry) === todayKey && entry.destination !== 'Timeline')));
	const lastLine = past[0] ? `Last time: ${when(past[0], todayKey)}, ${ago(entryDateKey(past[0]), todayKey)}.` : '';

	if (!matches.length) {
		return {
			kind: question.kind,
			summary: question.terms.length ? `Nothing in your traces matches ${topic}.` : 'Ask about something you have captured, for example “Hvornår var jeg sidst hos tandlægen?”',
			entries: []
		};
	}

	if (question.kind === 'trend') {
		const scored = past.filter((entry) => wellbeingScoreOf(entry) !== undefined);
		if (scored.length) {
			const today = parseDateKey(todayKey);
			const inWindow = (entry: TimelineEntry, fromDays: number, toDays: number) => {
				const days = daysBetween(entryDateKey(entry), localDateKey(today));
				return days >= fromDays && days <= toDays;
			};
			const thisWeek = scored.filter((entry) => inWindow(entry, 0, 6)).map((entry) => wellbeingScoreOf(entry)!);
			const lastWeek = scored.filter((entry) => inWindow(entry, 7, 13)).map((entry) => wellbeingScoreOf(entry)!);
			const latest = scored[0];
			const name = capitalize(question.subject);
			const summary = thisWeek.length
				? `${name}: ${format(average(thisWeek))} / 10 on average over the last 7 days (${thisWeek.length} ${thisWeek.length === 1 ? 'score' : 'scores'})${
						lastWeek.length ? `, ${average(thisWeek) > average(lastWeek) ? 'up' : average(thisWeek) < average(lastWeek) ? 'down' : 'unchanged'} from ${format(average(lastWeek))} the week before` : ''
					}. Latest: ${format(wellbeingScoreOf(latest)!)} ${relativeDayLabel(entryDateKey(latest), todayKey).toLocaleLowerCase('en-GB')}.`
				: `No scores for ${name} in the last 7 days. Latest: ${format(wellbeingScoreOf(latest)!)}, ${ago(entryDateKey(latest), todayKey)}.`;
			return { kind: 'trend', summary, entries: scored.slice(0, 7), partial };
		}
		return { kind: 'last', summary: lastLine || `Nothing scored for ${topic} yet.`, entries: past.slice(0, 5), partial };
	}

	if (question.kind === 'next') {
		if (future[0]) return { kind: 'next', summary: `Next: ${when(future[0], todayKey)}, ${ago(entryDateKey(future[0]), todayKey)}.`, entries: future.slice(0, 5), partial };
		return { kind: 'next', summary: `Nothing planned for ${topic}. ${lastLine}`.trim(), entries: past.slice(0, 3), partial };
	}

	if (question.kind === 'today') {
		const today = past.filter((entry) => entryDateKey(entry) === todayKey);
		if (today[0]) return { kind: 'today', summary: `Yes, ${when(today[0], todayKey).replace(/^Today/, 'today')}.`, entries: today.slice(0, 5), partial };
		return { kind: 'today', summary: `Not today. ${lastLine}`.trim(), entries: past.slice(0, 3), partial };
	}

	if (question.kind === 'where') {
		const latest = newestFirst(matches)[0];
		return { kind: 'where', summary: `Latest: “${latest.transcript}” (${when(latest, todayKey)}).`, entries: newestFirst(matches).slice(0, 3), partial };
	}

	if (question.kind === 'search') {
		return { kind: 'search', summary: `${matches.length} ${matches.length === 1 ? 'trace mentions' : 'traces mention'} ${topic}.`, entries: newestFirst(matches).slice(0, 5), partial };
	}

	return { kind: 'last', summary: lastLine || `Only planned so far: ${when(future[0], todayKey)}.`, entries: (past.length ? past : future).slice(0, 5), partial };
}
