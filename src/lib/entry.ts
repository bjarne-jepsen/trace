import { addDays, describeSchedule, localDateKey } from './dates';

export type EntryCategory = 'Wellbeing' | 'Reminder' | 'Habit' | 'Place' | 'Social' | 'Note';
export type EntryStatus = 'Planned' | 'Completed' | 'Tentative';
export type ClassificationConfidence = 'High' | 'Medium' | 'Low' | 'User selected';
export type EntryDestination = 'Timeline' | 'Calendar' | 'Reminder';
export type EntrySyncStatus = 'Local' | 'Ready' | 'Synced' | 'Failed';
export type ExternalProvider = 'Google Calendar' | 'Google Tasks';

export type EntryDraft = {
	category: EntryCategory;
	title: string;
	detail: string;
	when: string;
	transcript: string;
	people?: string[];
	status?: EntryStatus;
	reminder?: boolean;
	calendar?: boolean;
	eventTime?: string;
	classificationConfidence?: ClassificationConfidence;
	classificationReason?: string;
	destination: EntryDestination;
	destinationConfidence?: ClassificationConfidence;
	destinationReason?: string;
	scheduledDate?: string;
	scheduledDates?: string[];
	scheduledTime?: string;
	/** The clock time was inferred ("at 7", "tonight") rather than stated unambiguously. */
	scheduledTimeAssumed?: boolean;
	/** The other reading of an ambiguous 12-hour time, e.g. "07:00" when "19:00" was assumed. */
	scheduledTimeAlternative?: string;
	/** A 0–10 score, only when the user actually said one. */
	wellbeingScore?: number;
	/** Minutes of activity the user described, logged or planned. */
	activityMinutes?: number;
	durationMinutes?: number;
	reminderMinutes?: number;
	seriesId?: string;
	occurrenceIndex?: number;
	occurrenceCount?: number;
	externalProvider?: ExternalProvider;
	externalId?: string;
	syncStatus?: EntrySyncStatus;
	placeAddress?: string;
	latitude?: number;
	longitude?: number;
	locationAccuracy?: number;
	locationCapturedAt?: string;
	googlePlaceId?: string;
	mapsSearchUrl?: string;
	mapsPinUrl?: string;
};

export type TimelineEntry = EntryDraft & {
	id: string;
	time: string;
	capturedAt: string;
};

const alternation = (values: string[]) => [...values].sort((left, right) => right.length - left.length).join('|');
const blank = (match: string) => ' '.repeat(match.length);
const capitalize = (value: string) => (value ? value[0].toLocaleUpperCase('da-DK') + value.slice(1) : value);

const MONTH_NAMES = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december'
];
const DANISH_MONTH_NAMES = [
	'januar',
	'februar',
	'marts',
	'april',
	'maj',
	'juni',
	'juli',
	'august',
	'september',
	'oktober',
	'november',
	'december'
];
const MONTH_ALIASES = MONTH_NAMES.flatMap((month, index) => [month, DANISH_MONTH_NAMES[index]]);
const MONTHS = alternation([...new Set(MONTH_ALIASES)]);
const MONTH_INDEX = new Map(MONTH_ALIASES.map((month, index) => [month, Math.floor(index / 2)]));
const WEEKDAY_ALIASES = [
	['sunday', 'søndag', 'sondag'],
	['monday', 'mandag'],
	['tuesday', 'tirsdag'],
	['wednesday', 'onsdag'],
	['thursday', 'torsdag'],
	['friday', 'fredag'],
	['saturday', 'lørdag', 'lordag']
];
const WEEKDAY_PATTERN = alternation(WEEKDAY_ALIASES.flat());

const EN_NUMBER_WORDS: Record<string, number> = {
	zero: 0,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	eleven: 11,
	twelve: 12,
	thirteen: 13,
	fourteen: 14,
	fifteen: 15,
	sixteen: 16,
	seventeen: 17,
	eighteen: 18,
	nineteen: 19,
	twenty: 20,
	thirty: 30,
	forty: 40,
	fifty: 50
};
const DA_NUMBER_WORDS: Record<string, number> = {
	nul: 0,
	en: 1,
	et: 1,
	to: 2,
	tre: 3,
	fire: 4,
	fem: 5,
	seks: 6,
	syv: 7,
	otte: 8,
	ni: 9,
	ti: 10,
	elleve: 11,
	tolv: 12,
	tretten: 13,
	fjorten: 14,
	femten: 15,
	seksten: 16,
	sytten: 17,
	atten: 18,
	nitten: 19,
	tyve: 20,
	tredive: 30,
	fyrre: 40,
	halvtreds: 50
};
// "a week" and "an hour" are amounts. "Look at a house" is not a clock time, so articles never count as hours.
const NUMBER_WORDS: Record<string, number> = { ...EN_NUMBER_WORDS, ...DA_NUMBER_WORDS, a: 1, an: 1 };
const NUMBER_TOKEN = `(?:\\d+(?:[.,]\\d+)?|${alternation(Object.keys(NUMBER_WORDS))})`;
const EN_HOUR_TOKEN = `(?:\\d{1,2}|${alternation(Object.keys(EN_NUMBER_WORDS))})`;
const DA_HOUR_TOKEN = `(?:\\d{1,2}|${alternation(Object.keys(DA_NUMBER_WORDS))})`;
const EN_MINUTE_WORDS: Record<string, number> = { "o'clock": 0, fifteen: 15, thirty: 30, 'forty five': 45, 'forty-five': 45 };

const REMINDER_PATTERN =
	/\b(remind me|remember to|don['’]?t forget|set (?:a |an )?reminder|mind mig om(?: at)?|husk at|glem ikke at|lav (?:en )?påmindelse|husk)\b/i;
const SCORE_SOURCE = `(?<![\\p{L}\\d.,])(${NUMBER_TOKEN})\\s*(?:\\/\\s*(?:10|ti|ten)|(?:out of|ud af|af)\\s+(?:10|ti|ten))(?![\\p{L}\\d])`;
const SCORE_PATTERN = new RegExp(SCORE_SOURCE, 'iu');
// Decimals followed by a unit are measurements ("1.5 hours"), never dates or clock times.
const MEASUREMENT_PATTERN =
	/\d+[.,]\d+\s*(?:hours?|hrs?|h|timer?|minutes?|mins?|minutter?|min|km|kilometers?|kilometer|miles?|kg|k|l|liters?|litres?|%)(?![\p{L}])/giu;
const MARKED_CLOCK_PATTERN = /\b(?:kl\.?|klokken|at)\s*\d{1,2}[.:]\d{2}\b/gi;

type Tense = 'past' | 'future' | 'neutral';

const STRONG_PAST = new RegExp(
	`\\b(?:yesterday|i går|i forgårs|ago|siden|this morning|i morges|last\\s+(?:week|night|${WEEKDAY_PATTERN})|sidste\\s+(?:uge|${WEEKDAY_PATTERN})|i\\s+(?:${WEEKDAY_PATTERN})s)\\b`,
	'i'
);
const FUTURE_CUE = new RegExp(
	`\\b(?:tomorrow|i morgen|i overmorgen|tonight|i aften|next|næste|will|going to|gonna|plan|planning|shall|skal|vil|kommende|upcoming|på\\s+(?:${WEEKDAY_PATTERN}))\\b`,
	'i'
);
const PAST_VERB =
	/\b(?:went|had|was|were|did|finished|completed|trained|ran|cycled|swam|walked|hiked|meditated|worked out|exercised|slept|felt|earlier|gik|havde|var|gjorde|afsluttede|trænede|løb|cyklede|svømmede|vandrede|mediterede|motionerede|sov|følte|tidligere)\b/i;

const MORNING_CONTEXT = /\b(?:morning|breakfast|morgenmad|formiddag|om morgenen|i morgen tidlig|tidlig)\b/i;
const EVENING_CONTEXT =
	/\b(?:evening|tonight|dinner|supper|drinks?|party|concert|date night|bar|cinema|movie|theatre|aften|aftenen|middag|aftensmad|fest|koncert|bytur|biograf|teater)\b/i;

function numberFrom(value: string) {
	const normalized = value.toLocaleLowerCase('da-DK');
	return NUMBER_WORDS[normalized] ?? Number(normalized.replace(',', '.'));
}

function weekdayIndex(value: string) {
	const normalized = value.toLocaleLowerCase('da-DK');
	return WEEKDAY_ALIASES.findIndex((aliases) => aliases.includes(normalized));
}

function tenseOf(text: string): Tense {
	if (REMINDER_PATTERN.test(text)) return 'future';
	if (STRONG_PAST.test(text)) return 'past';
	if (FUTURE_CUE.test(text)) return 'future';
	if (PAST_VERB.test(text)) return 'past';
	return 'neutral';
}

type DateReading = { date?: string; dates?: string[]; tokenIndex?: number; tokenLength?: number };

function resolveWeekdays(text: string, today: Date, tense: Tense) {
	const matches = [
		...text.matchAll(new RegExp(`\\b(?:(next|næste|last|sidste|this|denne|on|på|i)\\s+)?(${WEEKDAY_PATTERN})(s)?\\b`, 'gi'))
	];
	if (!matches.length) return [];
	const todayIndex = today.getDay();
	const nextWeek = /\b(?:next week|næste uge)\b/i.test(text);
	const lastWeek = /\b(?:last week|sidste uge)\b/i.test(text);
	const dates = matches.map((match) => {
		const prefix = match[1]?.toLocaleLowerCase('da-DK');
		const target = weekdayIndex(match[2]);
		const explicitPast = prefix === 'last' || prefix === 'sidste' || (prefix === 'i' && Boolean(match[3]));
		const explicitFuture = prefix === 'next' || prefix === 'næste' || prefix === 'på';
		if (lastWeek || explicitPast || (!explicitFuture && !nextWeek && tense === 'past')) {
			if (lastWeek) {
				const previousMonday = -((todayIndex + 6) % 7) - 7;
				return localDateKey(addDays(today, previousMonday + ((target + 6) % 7)));
			}
			let daysBack = (todayIndex - target + 7) % 7;
			if (daysBack === 0 && explicitPast) daysBack = 7;
			return localDateKey(addDays(today, -daysBack));
		}
		// "Next Monday" and "næste mandag" mean the Monday of next calendar week, like "next week: Monday".
		if (nextWeek || prefix === 'next' || prefix === 'næste') {
			const nextMonday = ((8 - todayIndex) % 7) || 7;
			return localDateKey(addDays(today, nextMonday + ((target + 6) % 7)));
		}
		const daysAhead = (target - todayIndex + 7) % 7 || 7;
		return localDateKey(addDays(today, daysAhead));
	});
	return [...new Set(dates)].sort();
}

function explicitDate(text: string, today: Date, tense: Tense): DateReading | null {
	const monthFirst = text.match(new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b\\.?(?:,?\\s+(\\d{4}))?`, 'i'));
	const dayFirst = text.match(
		new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\.?(?:\\s+of)?\\s+(${MONTHS})\\b(?:,?\\s+(\\d{4}))?`, 'i')
	);
	const numeric = text.match(/(?:^|\s)(den\s+|d\.\s*)?(\d{1,2})([/.-])(\d{1,2})(?:\3(\d{4}|\d{2}))?(\.)?(?=\s|[,!?]|$)/i);
	let parts: { day: number; month: number; year?: number; index: number; length: number } | null = null;
	const named = monthFirst || dayFirst;
	if (named) {
		const monthName = (monthFirst ? monthFirst[1] : dayFirst![2]).toLocaleLowerCase('da-DK');
		parts = {
			day: Number(monthFirst ? monthFirst[2] : dayFirst![1]),
			month: MONTH_INDEX.get(monthName) ?? -1,
			year: Number(monthFirst ? monthFirst[3] : dayFirst![3]) || undefined,
			index: named.index ?? 0,
			length: named[0].length
		};
	} else if (numeric) {
		const [, marker, day, separator, month, year, trailingDot] = numeric;
		// "10.05" on its own is a Danish clock time. It only counts as a date with a year, a trailing dot,
		// "den"/"d.", a single-digit month ("10.5"), or a slash or dash.
		const readsAsClock = separator === '.' && month.length === 2 && !marker && !year && !trailingDot;
		if (!readsAsClock) {
			let parsedYear = year ? Number(year) : undefined;
			if (parsedYear !== undefined && parsedYear < 100) parsedYear += 2000;
			parts = { day: Number(day), month: Number(month) - 1, year: parsedYear, index: numeric.index ?? 0, length: numeric[0].length };
		}
	}
	if (!parts || parts.month < 0 || parts.month > 11 || parts.day < 1 || parts.day > 31) return null;
	const build = (year: number) => new Date(year, parts.month, parts.day, 12);
	let date = build(parts.year ?? today.getFullYear());
	if (date.getMonth() !== parts.month) return null;
	if (!parts.year) {
		const todayKey = localDateKey(today);
		if (tense !== 'past' && localDateKey(date) < todayKey) date = build(date.getFullYear() + 1);
		else if (tense === 'past' && localDateKey(date) > todayKey) date = build(date.getFullYear() - 1);
	}
	return { date: localDateKey(date), tokenIndex: parts.index, tokenLength: parts.length };
}

function extractDates(text: string, today: Date, tense: Tense): DateReading {
	const after = (days: number) => ({ date: localDateKey(addDays(today, days)) });
	if (/\b(?:day after tomorrow|i overmorgen)\b/i.test(text)) return after(2);
	if (/\b(?:tomorrow|i morgen)\b/i.test(text)) return after(1);
	if (/\b(?:day before yesterday|i forgårs)\b/i.test(text)) return after(-2);
	if (/\b(?:yesterday|i går)\b/i.test(text)) return after(-1);
	if (/\b(?:today|i dag|tonight|this (?:morning|afternoon|evening)|i aften|i eftermiddag|i formiddag|i morges)\b/i.test(text)) {
		return after(0);
	}
	const unitDays = (amount: string, unit: string) => Math.round(numberFrom(amount) * (/^(?:weeks?|uger?)$/i.test(unit) ? 7 : 1));
	const ahead = text.match(new RegExp(`\\b(?:in|om)\\s+(${NUMBER_TOKEN})\\s+(days?|dage?|weeks?|uger?)\\b`, 'i'));
	if (ahead) return after(unitDays(ahead[1], ahead[2]));
	const ago = text.match(new RegExp(`\\b(${NUMBER_TOKEN})\\s+(days?|dage?|weeks?|uger?)\\s+(?:ago|siden)\\b`, 'i'));
	if (ago) return after(-unitDays(ago[1], ago[2]));
	const weekdays = resolveWeekdays(text, today, tense);
	if (weekdays.length) return { date: weekdays[0], dates: weekdays.length > 1 ? weekdays : undefined };
	if (/\b(?:next week|næste uge)\b/i.test(text)) return after(7);
	return explicitDate(text, today, tense) ?? {};
}

type ClockReading = { time: string; assumed: boolean; alternative?: string };

const clock = (hour: number, minute: number) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

function readTwelveHourClock(hour: number, minute: number, text: string): ClockReading | undefined {
	if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
	if (hour === 0 || hour >= 12) return { time: clock(hour, minute), assumed: false };
	// Nobody books dinner at 07:00 or the dentist at 03:00. Pick the likely half of the day, but say it was a guess.
	const afternoon = !MORNING_CONTEXT.test(text) && (EVENING_CONTEXT.test(text) || hour <= 6);
	return {
		time: clock(afternoon ? hour + 12 : hour, minute),
		assumed: true,
		alternative: clock(afternoon ? hour : hour + 12, minute)
	};
}

function extractScheduledTime(text: string): ClockReading | undefined {
	const meridiem = text.match(/\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![\p{L}])/iu);
	if (meridiem) {
		const hour = Number(meridiem[1]);
		const minute = Number(meridiem[2] || 0);
		if (hour >= 1 && hour <= 12 && minute <= 59) {
			return { time: clock((hour % 12) + (/^p/i.test(meridiem[3]) ? 12 : 0), minute), assumed: false };
		}
	}
	const marked = text.match(/\b(?:kl\.?|klokken)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/i);
	if (marked) {
		const hour = Number(marked[1]);
		const minute = Number(marked[2]);
		// Written Danish times are 24-hour ("kl. 7.30" is morning), but "kl. 3.30" is almost never the middle of the night.
		return hour >= 1 && hour <= 6 ? readTwelveHourClock(hour, minute, text) : { time: clock(hour, minute), assumed: false };
	}
	const written = text.match(/(?<![\d.:/-])([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d:]|\.\d)/);
	if (written) {
		const reading = readTwelveHourClock(Number(written[1]), Number(written[2]), text);
		if (reading) return reading;
	}
	const spokenEnglish = text.match(
		new RegExp(
			`\\bat\\s+(${EN_HOUR_TOKEN})(?:\\s+(o'clock|fifteen|thirty|forty[- ]five))?\\b(?!\\s*(?:minutes?|mins?|hours?|%|km|kg|people|persons?|years?|times))`,
			'i'
		)
	);
	if (spokenEnglish) {
		const reading = readTwelveHourClock(
			numberFrom(spokenEnglish[1]),
			EN_MINUTE_WORDS[spokenEnglish[2]?.toLowerCase() ?? ''] ?? 0,
			text
		);
		if (reading) return reading;
	}
	const spokenDanish = text.match(new RegExp(`\\b(?:klokken|kl\\.?)\\s*(${DA_HOUR_TOKEN})\\b(?![.:]\\d)`, 'i'));
	if (spokenDanish) {
		const reading = readTwelveHourClock(numberFrom(spokenDanish[1]), 0, text);
		if (reading) return reading;
	}
	const fromTarget = (target: number, minute: number, before: boolean) => {
		if (!Number.isInteger(target) || target < 1 || target > 24) return undefined;
		const hour = before ? (target + 23) % 24 : target % 24;
		return readTwelveHourClock(hour === 0 ? 12 : hour, minute, text);
	};
	const danishHalf = text.match(new RegExp(`\\bhalv\\s+(${DA_HOUR_TOKEN})\\b`, 'i'));
	if (danishHalf) {
		const reading = fromTarget(numberFrom(danishHalf[1]), 30, true);
		if (reading) return reading;
	}
	const danishQuarter = text.match(new RegExp(`\\bkvart\\s+(over|i)\\s+(${DA_HOUR_TOKEN})\\b`, 'i'));
	if (danishQuarter) {
		const before = danishQuarter[1].toLowerCase() === 'i';
		const reading = fromTarget(numberFrom(danishQuarter[2]), before ? 45 : 15, before);
		if (reading) return reading;
	}
	const englishHalf = text.match(new RegExp(`\\bhalf past\\s+(${EN_HOUR_TOKEN})\\b`, 'i'));
	if (englishHalf) {
		const reading = fromTarget(numberFrom(englishHalf[1]), 30, false);
		if (reading) return reading;
	}
	const englishQuarter = text.match(new RegExp(`\\bquarter\\s+(past|to)\\s+(${EN_HOUR_TOKEN})\\b`, 'i'));
	if (englishQuarter) {
		const before = englishQuarter[1].toLowerCase() === 'to';
		const reading = fromTarget(numberFrom(englishQuarter[2]), before ? 45 : 15, before);
		if (reading) return reading;
	}
	if (/\bnoon\b/i.test(text)) return { time: '12:00', assumed: true };
	if (/\b(?:morning|om morgenen|i morgen tidlig)\b/i.test(text)) return { time: '09:00', assumed: true };
	if (/\b(?:formiddag|formiddagen)\b/i.test(text)) return { time: '10:00', assumed: true };
	if (/\b(?:afternoon|eftermiddag|eftermiddagen)\b/i.test(text)) return { time: '14:00', assumed: true };
	if (/\b(?:evening|tonight|aften|aftenen)\b/i.test(text)) return { time: '19:00', assumed: true };
	return undefined;
}

type Schedule = { tense: Tense; date?: string; dates?: string[]; time?: ClockReading };

/**
 * Reads dates and times so that one piece of text has one meaning: a score ("7/10"), a measurement ("1.5 hours")
 * or a clock time ("kl. 10.05") is never also read as a date.
 */
function parseSchedule(text: string, category: EntryCategory, today: Date): Schedule {
	const tense = tenseOf(text);
	let scrubbed = text.replace(MEASUREMENT_PATTERN, blank);
	if (category === 'Wellbeing') {
		scrubbed = scrubbed.replace(new RegExp(SCORE_SOURCE, 'giu'), blank).replace(/(?<![\d.,])(?<!(?:kl\.?|klokken|at)\s*)\d+[.,]\d+/gi, blank);
	}
	const dates = extractDates(scrubbed.replace(MARKED_CLOCK_PATTERN, blank), today, tense);
	const timeText =
		dates.tokenIndex === undefined || dates.tokenLength === undefined
			? scrubbed
			: scrubbed.slice(0, dates.tokenIndex) + ' '.repeat(dates.tokenLength) + scrubbed.slice(dates.tokenIndex + dates.tokenLength);
	return { tense, date: dates.date, dates: dates.dates, time: extractScheduledTime(timeText) };
}

function durationMinutesFrom(text: string) {
	const hourMatch = text.match(new RegExp(`(?:^|\\s)(${NUMBER_TOKEN})\\s*(?:hours?|hrs?|timer?|time)(?=\\s|[,.!?]|$)`, 'i'));
	const minuteMatch = text.match(new RegExp(`(?:^|\\s)(${NUMBER_TOKEN})\\s*(?:minutes?|mins?|minutter?|min)(?=\\s|[,.!?]|$)`, 'i'));
	const halfHours = /\b(?:an?\s+half|en\s+halv)\s+(?:hour|time)\b/i.test(text) ? 30 : /\bhalvanden\s+time\b/i.test(text) ? 90 : 0;
	const quarters = /\b(?:three quarters|tre kvarter)\b/i.test(text) ? 45 : /\b(?:a quarter|et kvarter)\b/i.test(text) ? 15 : 0;
	const total = Math.round(
		(hourMatch ? numberFrom(hourMatch[1]) * 60 : 0) + (minuteMatch ? numberFrom(minuteMatch[1]) : 0) + halfHours + quarters
	);
	return total || undefined;
}

function wellbeingScoreFrom(text: string) {
	const match = text.match(SCORE_PATTERN);
	if (!match) return undefined;
	const score = numberFrom(match[1]);
	return Number.isFinite(score) && score >= 0 && score <= 10 ? score : undefined;
}

function wellbeingTitle(text: string) {
	if (/tinnitus/i.test(text)) return 'Tinnitus';
	if (/\b(?:headache|migraine|hovedpine|migræne)\b/i.test(text)) return 'Headache';
	if (/\b(?:slept|sleep|sov|søvn)\b/i.test(text)) return 'Sleep';
	if (/\b(?:energy|energi|tired|træt)\b/i.test(text)) return 'Energy';
	if (/\b(?:stress|anxiety|angst)\b/i.test(text)) return 'Stress';
	if (/\b(?:mood|humør)/i.test(text)) return 'Mood';
	return 'Wellbeing check-in';
}

function habitTitle(text: string) {
	if (/\b(?:meditat|mediter)/i.test(text)) return 'Meditation';
	if (/\byoga\b/i.test(text)) return 'Yoga';
	if (/\b(?:swim|swam|svøm)/i.test(text)) return 'Swimming';
	if (/\b(?:cycl|bike|biking|cykl|cykel)/i.test(text)) return 'Cycling';
	if (/\b(?:run|ran|running|jog|jogging|jogged|løb|løbe|løbetur)\b/i.test(text)) return 'Running';
	if (/\b(?:walk|walked|walking|hike|hiked|hiking|gåtur|gik en tur|vandre|vandrede|vandretur)\b/i.test(text)) return 'Walking';
	if (/\b(?:read|reading|læse|læste|læser|læsning)\b/i.test(text)) return 'Reading';
	return 'Training';
}

function placeTitle(text: string) {
	const named = text.match(/\b(?:called|named|kaldet|hedder)\s+(.+?)(?=[.!?,]|\s+(?:in|on|near|i|på|ved|nær)\s|$)/i)?.[1];
	if (named?.trim()) return capitalize(named.trim());
	const described = text
		.replace(
			/^(?:(?:i|we|jeg|vi)\s+)?(?:just\s+|lige\s+)?(?:found|discovered|save this place:?|want to visit|recommended|fandt|opdagede|gem dette sted:?|vil (?:gerne )?besøge|anbefalet)\s+/i,
			''
		)
		.replace(/^(?:a|an|the|this|that|en|et|den|det|denne|dette)\s+/i, '')
		.replace(/[.!?]+$/, '')
		.trim();
	if (!described) return 'Saved place';
	return capitalize(described.length > 60 ? `${described.slice(0, 60).trimEnd()}…` : described);
}

const PEOPLE_STOP_WORDS = new Set([
	'on',
	'at',
	'in',
	'for',
	'to',
	'about',
	'this',
	'next',
	'last',
	'today',
	'tomorrow',
	'tonight',
	'yesterday',
	'from',
	'by',
	'around',
	'after',
	'before',
	'på',
	'i',
	'om',
	'til',
	'kl',
	'kl.',
	'klokken',
	'halv',
	'kvart',
	'den',
	'næste',
	'sidste',
	'fra',
	'efter',
	'før',
	'omkring',
	'hos',
	...WEEKDAY_ALIASES.flat(),
	...MONTH_ALIASES
]);

function extractPeople(text: string) {
	const start = text.match(/\b(?:with|med)\s+/i);
	if (!start || start.index === undefined) return [];
	const words: string[] = [];
	for (const word of text.slice(start.index + start[0].length).split(/\s+/)) {
		const bare = word.replace(/[.!?;:]+$/, '');
		if (!bare || PEOPLE_STOP_WORDS.has(bare.toLocaleLowerCase('da-DK').replace(/,$/, '')) || /\d/.test(bare)) break;
		words.push(bare);
		if (bare !== word) break;
	}
	return words
		.join(' ')
		.replace(/,$/, '')
		.split(/\s+(?:and|og|&)\s+|,\s*/i)
		.map((name) => name.trim())
		.filter(Boolean);
}

const SCHEDULE_PHRASES = [
	/\b(?:the\s+)?day after tomorrow\b|\bi overmorgen\b|\b(?:the\s+)?day before yesterday\b|\bi forgårs\b/gi,
	/\b(?:tomorrow|today|tonight|yesterday|i morgen(?:\s+tidlig)?|i dag|i aften|i går|i eftermiddag|i formiddag)\b/gi,
	new RegExp(`\\b(?:(?:on|this|next|næste|last|sidste|på|i)\\s+)?(?:${WEEKDAY_PATTERN})s?\\b`, 'gi'),
	/\b(?:next week|næste uge|this week|denne uge)\b/gi,
	new RegExp(`\\b(?:in|om)\\s+${NUMBER_TOKEN}\\s+(?:days?|dage?|weeks?|uger?)\\b`, 'gi'),
	new RegExp(`\\bat\\s+${EN_HOUR_TOKEN}(?:[:.]\\d{2})?(?:\\s*(?:a\\.?m\\.?|p\\.?m\\.?|o'clock))?(?![\\p{L}\\d])`, 'giu'),
	new RegExp(`\\b(?:kl\\.?|klokken)\\s*${DA_HOUR_TOKEN}(?:[:.]\\d{2})?(?![\\p{L}\\d])`, 'giu'),
	new RegExp(`\\b(?:halv|kvart\\s+(?:over|i))\\s+${DA_HOUR_TOKEN}\\b|\\b(?:half past|quarter\\s+(?:past|to))\\s+${EN_HOUR_TOKEN}\\b`, 'gi'),
	/\b(?:in the (?:morning|afternoon|evening)|this (?:morning|afternoon|evening)|om (?:morgenen|eftermiddagen|aftenen))\b/gi,
	new RegExp(
		`\\b(?:(?:on|den|d\\.)\\s+)?(?:(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}(?:st|nd|rd|th)?\\.?(?:\\s+of)?\\s+(?:${MONTHS}))\\b(?:,?\\s+\\d{4})?`,
		'gi'
	),
	/(?:\b(?:on|den|d\.)\s*)?\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g
];

function stripSchedulePhrases(text: string) {
	let result = text;
	for (const pattern of SCHEDULE_PHRASES) result = result.replace(pattern, ' ');
	return result
		.replace(/\s+/g, ' ')
		.replace(/\s+([,.!?])/g, '$1')
		.replace(/(?:[\s,;:–-]|\b(?:on|at|by|til|på|den|om|and|og))+$/i, '')
		.replace(/^[\s,;:–-]+/, '')
		.trim();
}

type Classification = {
	category: EntryCategory;
	confidence: ClassificationConfidence;
	reason: string;
};

type Routing = {
	destination: EntryDestination;
	confidence: ClassificationConfidence;
	reason: string;
	scheduledDate?: string;
	scheduledDates?: string[];
	scheduledTime?: string;
	scheduledTimeAssumed?: boolean;
	scheduledTimeAlternative?: string;
	durationMinutes?: number;
	reminderMinutes?: number;
	externalProvider?: ExternalProvider;
	syncStatus: EntrySyncStatus;
};

function routeEntry(text: string, category: EntryCategory, schedule: Schedule, historical: boolean): Routing {
	const timing = {
		scheduledDate: schedule.date,
		scheduledDates: schedule.dates,
		scheduledTime: schedule.time?.time,
		scheduledTimeAssumed: schedule.time?.assumed || undefined,
		scheduledTimeAlternative: schedule.time?.alternative,
		syncStatus: 'Local' as const
	};
	const explicitReminder = text.match(REMINDER_PATTERN);
	const calendarSignal = text.match(
		/\b(appointment|meeting|dinner|lunch|brunch|drinks?|concert|evening out|party|date night|reservation|flight|dentist|doctor|hairdresser|cinema|theatre|aftale|møde|middag|frokost|koncert|bytur|fest|date|fly|tandlæge|læge|frisør|biograf|teater)\b/i
	);

	if (explicitReminder) {
		return {
			...timing,
			destination: 'Reminder',
			confidence: 'High',
			reason: `Action inferred from “${explicitReminder[1]}”`,
			reminderMinutes: 0,
			externalProvider: timing.scheduledTime ? 'Google Calendar' : 'Google Tasks'
		};
	}

	const upcoming = { durationMinutes: 60, reminderMinutes: 30, externalProvider: 'Google Calendar' as const };
	if (!historical && calendarSignal && (timing.scheduledDate || timing.scheduledTime)) {
		return {
			...timing,
			...upcoming,
			destination: 'Calendar',
			confidence: 'High',
			reason: `Upcoming “${calendarSignal[1]}” with scheduling details`
		};
	}

	if (!historical && category === 'Reminder' && (timing.scheduledDate || timing.scheduledTime)) {
		return {
			...timing,
			destination: 'Reminder',
			confidence: 'Medium',
			reason: 'Task with an upcoming date',
			reminderMinutes: 0,
			externalProvider: timing.scheduledTime ? 'Google Calendar' : 'Google Tasks'
		};
	}

	if (!historical && category === 'Social' && timing.scheduledDate) {
		return {
			...timing,
			...upcoming,
			durationMinutes: 120,
			destination: 'Calendar',
			confidence: 'Medium',
			reason: 'Future social entry with a date'
		};
	}

	if (!historical && category === 'Habit' && timing.scheduledDate) {
		return {
			...timing,
			...upcoming,
			durationMinutes: durationMinutesFrom(text) || 60,
			destination: 'Calendar',
			confidence: 'Medium',
			reason: 'Future habit with a scheduled date'
		};
	}

	return {
		...timing,
		destination: 'Timeline',
		confidence: historical ? 'High' : 'Medium',
		reason: historical ? 'Captured as something that already happened' : 'No action was explicitly requested'
	};
}

function classifyEntry(text: string): Classification {
	const explicitReminder = text.match(REMINDER_PATTERN);
	if (explicitReminder) {
		return { category: 'Reminder', confidence: 'High', reason: `Matched “${explicitReminder[1]}”` };
	}

	const scores = new Map<EntryCategory, { score: number; signals: string[] }>();
	const add = (category: EntryCategory, score: number, signal: string) => {
		const current = scores.get(category) || { score: 0, signals: [] };
		current.score += score;
		if (!current.signals.includes(signal)) current.signals.push(signal);
		scores.set(category, current);
	};
	const match = (category: EntryCategory, pattern: RegExp, score: number, label?: string) => {
		const found = text.match(pattern);
		if (found) add(category, score, label || found[0].toLowerCase());
	};

	match('Place', /\b(found|discovered|save this place|want to visit|recommend(?:ed)?|fandt|opdagede|gem dette sted|vil besøge|anbefalet)\b/i, 3);
	match('Place', /(?<![\p{L}])(restaurant|bar|café|cafe|viewpoint|museum|bakery|hotel|place|udsigtspunkt|bageri|sted)(?![\p{L}])/iu, 2);

	match('Social', /\b(meeting|dinner|lunch|drinks?|concert|evening out|party|brunch|date night|catch(?:ing)? up|møde|middag|frokost|koncert|aften ude|bytur|fest)\b/i, 3);
	match('Social', /\b(coffee|visit|meet|kaffe|besøg|mødes)\b/i, 2);
	match('Social', /\b(?:with|med)\s+[\p{L}]/iu, 1, 'with someone');

	match('Wellbeing', /\b(tinnitus|headache|migraine|mood|wellbeing|anxiety|stress|energy|pain|hovedpine|migræne|humør|velbefindende|angst|energi|smerte)\b/i, 3);
	match('Wellbeing', /\b(feel|feeling|felt|slept|sleep|føler|følelse|følte|sov|søvn)\b/i, 2);
	if (wellbeingScoreFrom(text) !== undefined) add('Wellbeing', 1, 'a 0–10 score');

	match('Habit', /\b(training|workout|exercise|gym|running|jogging|cycling|swimming|meditation|reading|yoga|padel|tennis|træning|træningscenter|fitnesscenter|motion|løb|løbetur|cykling|svømning|meditation|læsning)\b/i, 3);
	match('Habit', /\b(train|trained|ran|run|jogged|cycle|cycled|swam|swim|walked|hiked|meditat(?:e|ed)|read|worked out|træne|trænede|løbe|cykle|cyklede|svømme|svømmede|gåtur|gik en tur|vandre|vandrede|meditere|mediterede|læse|læste)\b/i, 3);
	match('Habit', new RegExp(`(?:^|\\s)${NUMBER_TOKEN}\\s*(?:hours?|hrs?|minutes?|mins?|timer?|minutter?|min)(?=\\s|[,.!?]|$)`, 'i'), 1, 'duration');

	match('Reminder', /\b(appointment|dentist|doctor|hairdresser|deadline|aftale|tandlæge|læge|frisør|frist)\b/i, 3);
	match('Reminder', /\b(call|email|book|buy|pick up|send|pay|ring|ringe|mail|booke|køb|købe|hent|hente|sende|betal|betale)\b/i, 2);

	const ranked = [...scores.entries()].sort((left, right) => right[1].score - left[1].score);
	const [winner, runnerUp] = ranked;
	if (!winner || winner[1].score < 2) {
		return { category: 'Note', confidence: 'Low', reason: 'No strong category signal' };
	}
	const lead = winner[1].score - (runnerUp?.[1].score || 0);
	const confidence: ClassificationConfidence = winner[1].score >= 5 || lead >= 3 ? 'High' : 'Medium';
	return {
		category: winner[0],
		confidence,
		reason: `Matched ${winner[1].signals.map((signal) => `“${signal}”`).join(' and ')}`
	};
}

/**
 * Turns a spoken or typed capture into an editable draft. Deterministic: the same text and the same `now`
 * always give the same draft. Anything that had to be guessed is marked so the confirmation can ask about it.
 */
export function interpretEntry(transcript: string, now = new Date()): EntryDraft {
	const text = transcript.trim();
	const today = addDays(now, 0);
	const todayKey = localDateKey(today);
	const classification = classifyEntry(text);
	const schedule = parseSchedule(text, classification.category, today);
	// A resolved date decides the tense. Verb cues only decide when the entry is dated today or not dated at all.
	const historical = schedule.date && schedule.date !== todayKey ? schedule.date < todayKey : schedule.tense === 'past';
	const routing = routeEntry(text, classification.category, schedule, historical);
	const base = {
		transcript: text,
		when: describeSchedule(routing.scheduledDate, routing.scheduledTime, todayKey),
		destination: routing.destination,
		destinationConfidence: routing.confidence,
		destinationReason: routing.reason,
		scheduledDate: routing.scheduledDate,
		scheduledDates: routing.scheduledDates,
		scheduledTime: routing.scheduledTime,
		scheduledTimeAssumed: routing.scheduledTimeAssumed,
		scheduledTimeAlternative: routing.scheduledTimeAlternative,
		durationMinutes: routing.durationMinutes,
		reminderMinutes: routing.reminderMinutes,
		externalProvider: routing.externalProvider,
		syncStatus: routing.syncStatus,
		calendar: routing.destination === 'Calendar',
		reminder: routing.destination === 'Reminder',
		classificationConfidence: classification.confidence,
		classificationReason: classification.reason
	};

	if (classification.category === 'Place') {
		return {
			...base,
			category: 'Place',
			title: placeTitle(text),
			detail: /\brestaurant\b/i.test(text)
				? 'Restaurant'
				: /\bbar\b/i.test(text)
					? 'Bar'
					: /(?<![\p{L}])caf[eé](?![\p{L}])/iu.test(text)
						? 'Café'
						: 'Place to revisit'
		};
	}

	if (classification.category === 'Social') {
		const people = extractPeople(text);
		const rawTitle = stripSchedulePhrases(
			text.replace(/^(?:plan|log|planlæg|notér)\s+/i, '').split(/\s+(?:with|med)\s+/i)[0]
		);
		return {
			...base,
			category: 'Social',
			title: rawTitle ? capitalize(rawTitle) : 'Social event',
			detail: people.length ? `With ${people.join(' & ')}` : 'Social event',
			people,
			status: historical ? 'Completed' : routing.scheduledDate ? 'Planned' : 'Tentative'
		};
	}

	if (classification.category === 'Wellbeing') {
		const wellbeingScore = wellbeingScoreFrom(text);
		return {
			...base,
			category: 'Wellbeing',
			title: wellbeingTitle(text),
			detail: wellbeingScore !== undefined ? `${wellbeingScore} / 10` : /tinnitus/i.test(text) ? 'Tinnitus noted' : 'Wellbeing noted',
			wellbeingScore
		};
	}

	if (classification.category === 'Habit') {
		const planned = Boolean(routing.scheduledDate) && !historical;
		const activityMinutes = durationMinutesFrom(text);
		return {
			...base,
			category: 'Habit',
			title: habitTitle(text),
			detail: activityMinutes
				? `${activityMinutes} minutes${planned ? ' planned' : ''}`
				: planned
					? 'Activity planned'
					: 'Activity logged',
			activityMinutes,
			status: planned ? 'Planned' : 'Completed'
		};
	}

	if (classification.category === 'Reminder') {
		const english = /^(?:remind me|remember|don['’]?t forget|set (?:a |an )?reminder)\b/i.test(text);
		const action = stripSchedulePhrases(
			text.replace(
				/^(?:remind me(?: to)?|remember to|don['’]?t forget(?: to)?|set (?:a |an )?reminder(?: to)?|mind mig om(?: at)?|husk(?: at)?|glem ikke at|lav (?:en )?påmindelse(?: om at)?)\s*/i,
				''
			)
		).replace(english ? /^(?:to|at)\s+/i : /^at\s+/i, '');
		return {
			...base,
			category: 'Reminder',
			title: action ? capitalize(action) : 'New reminder',
			detail: 'Reminder saved in Trace'
		};
	}

	return {
		...base,
		category: 'Note',
		title: text.length > 42 ? `${text.slice(0, 42)}…` : text,
		detail: 'General timeline entry'
	};
}
