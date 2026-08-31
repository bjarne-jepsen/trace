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
const MONTHS = [...new Set(MONTH_ALIASES)].join('|');
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
const WEEKDAYS = WEEKDAY_ALIASES.flat();
const WEEKDAY_PATTERN = WEEKDAYS.join('|');
const NUMBER_WORDS: Record<string, number> = {
	zero: 0,
	nul: 0,
	one: 1,
	a: 1,
	an: 1,
	en: 1,
	et: 1,
	two: 2,
	to: 2,
	three: 3,
	tre: 3,
	four: 4,
	fire: 4,
	five: 5,
	fem: 5,
	six: 6,
	seks: 6,
	seven: 7,
	syv: 7,
	eight: 8,
	otte: 8,
	nine: 9,
	ni: 9,
	ten: 10,
	ti: 10,
	eleven: 11,
	elleve: 11,
	twelve: 12,
	tolv: 12,
	thirteen: 13,
	tretten: 13,
	fourteen: 14,
	fjorten: 14,
	fifteen: 15,
	femten: 15,
	sixteen: 16,
	seksten: 16,
	seventeen: 17,
	sytten: 17,
	eighteen: 18,
	atten: 18,
	nineteen: 19,
	nitten: 19,
	twenty: 20,
	tyve: 20,
	thirty: 30,
	tredive: 30,
	forty: 40,
	fyrre: 40,
	fifty: 50,
	halvtreds: 50
};
const NUMBER_TOKEN = `(?:\\d+(?:[.,]\\d+)?|${Object.keys(NUMBER_WORDS).join('|')})`;
const REMINDER_PATTERN = /\b(remind me|remember to|don['’]?t forget|set (?:a |an )?reminder|mind mig om(?: at)?|husk at|glem ikke at|lav (?:en )?påmindelse)\b/i;

function numberFrom(value: string) {
	const normalized = value.toLocaleLowerCase('da-DK').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
	return NUMBER_WORDS[normalized] ?? Number(normalized.replace(',', '.'));
}

function weekdayIndex(value: string) {
	const normalized = value.toLocaleLowerCase('da-DK');
	return WEEKDAY_ALIASES.findIndex((aliases) => aliases.includes(normalized));
}

function extractWeekdayDates(text: string, today = new Date()) {
	const start = new Date(today);
	start.setHours(0, 0, 0, 0);
	const matches = [...text.matchAll(new RegExp(`\\b(?:(next|næste)\\s+)?(${WEEKDAY_PATTERN})\\b`, 'gi'))];
	if (!matches.length) return [];
	const appliesToNextWeek = /\b(?:next week|næste uge)\b/i.test(text);
	const nextWeekMonday = new Date(start);
	if (appliesToNextWeek) {
		const daysUntilMonday = ((8 - start.getDay()) % 7) || 7;
		nextWeekMonday.setDate(start.getDate() + daysUntilMonday);
	}
	const dates = matches
		.map((match) => {
			const target = weekdayIndex(match[2]);
			if (appliesToNextWeek) {
				const date = new Date(nextWeekMonday);
				const daysAfterMonday = (target + 6) % 7;
				date.setDate(nextWeekMonday.getDate() + daysAfterMonday);
				return localDateKey(date);
			}
			let daysAhead = (target - start.getDay() + 7) % 7;
			if (daysAhead === 0 || match[1]) daysAhead += 7;
			const date = new Date(start);
			date.setDate(date.getDate() + daysAhead);
			return localDateKey(date);
		})
		.filter((date, index, all) => all.indexOf(date) === index)
		.sort();
	return dates;
}

function explicitDateParts(text: string) {
	const monthFirst = text.match(
		new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\.?(?:,?\\s+(\\d{4}))?`, 'i')
	);
	const dayFirst = text.match(
		new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\.?(?:\\s+of)?\\s+(${MONTHS})(?:,?\\s+(\\d{4}))?`, 'i')
	);
	const numeric = text.match(/(?:^|\s)(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2}|\d{4}))?(?=\s|[,.!?]|$)/);
	if (!monthFirst && !dayFirst && !numeric) return null;
	if (numeric) {
		let year = numeric[3] ? Number(numeric[3]) : undefined;
		if (year !== undefined && year < 100) year += 2000;
		return { day: Number(numeric[1]), month: Number(numeric[2]) - 1, year };
	}
	const monthName = (monthFirst?.[1] || dayFirst?.[2] || '').toLocaleLowerCase('da-DK');
	return {
		day: Number(monthFirst?.[2] || dayFirst?.[1]),
		month: MONTH_INDEX.get(monthName) ?? -1,
		year: Number(monthFirst?.[3] || dayFirst?.[3]) || undefined
	};
}

function localDateKey(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function extractScheduledDate(text: string) {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const relative = new Date(today);
	if (/\b(?:day after tomorrow|i overmorgen)\b/i.test(text)) {
		relative.setDate(relative.getDate() + 2);
		return localDateKey(relative);
	}
	if (/\b(?:tomorrow|i morgen)\b/i.test(text)) {
		relative.setDate(relative.getDate() + 1);
		return localDateKey(relative);
	}
	if (/\b(?:today|i dag)\b/i.test(text)) return localDateKey(relative);
	if (/\b(?:yesterday|i går)\b/i.test(text)) {
		relative.setDate(relative.getDate() - 1);
		return localDateKey(relative);
	}

	const relativeAmount = text.match(new RegExp(`\\b(?:in|om)\\s+(${NUMBER_TOKEN})\\s+(days?|dage?|weeks?|uger?)\\b`, 'i'));
	if (relativeAmount) {
		const amount = numberFrom(relativeAmount[1]);
		const multiplier = /weeks?|uger?/i.test(relativeAmount[2]) ? 7 : 1;
		relative.setDate(relative.getDate() + amount * multiplier);
		return localDateKey(relative);
	}
	const weekdayDates = extractWeekdayDates(text, today);
	if (weekdayDates.length) return weekdayDates[0];
	if (/\b(?:next week|næste uge)\b/i.test(text)) {
		relative.setDate(relative.getDate() + 7);
		return localDateKey(relative);
	}

	const explicit = explicitDateParts(text);
	if (!explicit || explicit.month < 0 || explicit.month > 11 || explicit.day < 1 || explicit.day > 31) return undefined;
	let year = explicit.year ?? today.getFullYear();
	let scheduled = new Date(year, explicit.month, explicit.day);
	const soundsHistorical = describesPastActivity(text) || /\b(?:earlier|tidligere)\b/i.test(text);
	if (!explicit.year && !soundsHistorical && scheduled < today) {
		year += 1;
		scheduled = new Date(year, explicit.month, explicit.day);
	}
	return localDateKey(scheduled);
}

function extractScheduledTime(text: string) {
	const meridiem = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
	if (meridiem) {
		let hour = Number(meridiem[1]) % 12;
		if (meridiem[3].toLowerCase().startsWith('p')) hour += 12;
		return `${String(hour).padStart(2, '0')}:${meridiem[2] || '00'}`;
	}
	const twentyFourHour = text.match(/\b(?:at\s+|klokken\s+|kl\.?\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/i);
	if (twentyFourHour) {
		return `${String(Number(twentyFourHour[1])).padStart(2, '0')}:${twentyFourHour[2]}`;
	}
	const spokenClock = text.match(new RegExp(`\\b(?:at|klokken|kl\\.?)\\s+(${NUMBER_TOKEN})(?:\\s+(${NUMBER_TOKEN}))?\\b`, 'i'));
	if (spokenClock) {
		const hour = numberFrom(spokenClock[1]);
		const minute = spokenClock[2] ? numberFrom(spokenClock[2]) : 0;
		if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
			return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
		}
	}
	const danishHalf = text.match(new RegExp(`\\bhalv\\s+(${NUMBER_TOKEN})\\b`, 'i'));
	if (danishHalf) {
		const target = numberFrom(danishHalf[1]);
		if (target >= 1 && target <= 24) return `${String((target + 23) % 24).padStart(2, '0')}:30`;
	}
	const danishQuarter = text.match(new RegExp(`\\bkvart\\s+(over|i)\\s+(${NUMBER_TOKEN})\\b`, 'i'));
	if (danishQuarter) {
		const target = numberFrom(danishQuarter[2]);
		if (target >= 1 && target <= 24) {
			const hour = danishQuarter[1].toLowerCase() === 'i' ? (target + 23) % 24 : target % 24;
			return `${String(hour).padStart(2, '0')}:${danishQuarter[1].toLowerCase() === 'i' ? '45' : '15'}`;
		}
	}
	if (/\bnoon\b/i.test(text)) return '12:00';
	if (/\b(?:morning|om morgenen|i morgen tidlig)\b/i.test(text)) return '09:00';
	if (/\b(?:afternoon|om eftermiddagen)\b/i.test(text)) return '14:00';
	if (/\b(?:evening|om aftenen|i aften)\b/i.test(text)) return '19:00';
	return undefined;
}

function durationMinutesFrom(text: string) {
	const hourMatch = text.match(new RegExp(`(?:^|\\s)(${NUMBER_TOKEN})\\s*(?:hours?|hrs?|timer?|time)(?=\\s|[,.!?]|$)`, 'i'));
	const minuteMatch = text.match(new RegExp(`(?:^|\\s)(${NUMBER_TOKEN})\\s*(?:minutes?|mins?|minutter?|min)(?=\\s|[,.!?]|$)`, 'i'));
	const halfHours = /\b(?:an?\s+half|en\s+halv)\s+(?:hour|time)\b/i.test(text) ? 30 : /\bhalvanden\s+time\b/i.test(text) ? 90 : 0;
	const quarters = /\b(?:three quarters|tre kvarter)\b/i.test(text) ? 45 : /\b(?:a quarter|et kvarter)\b/i.test(text) ? 15 : 0;
	const total = (hourMatch ? numberFrom(hourMatch[1]) * 60 : 0) + (minuteMatch ? numberFrom(minuteMatch[1]) : 0) + halfHours + quarters;
	return total || undefined;
}

function durationFrom(text: string, planned = false) {
	const total = durationMinutesFrom(text);
	return total ? `${total} minutes${planned ? ' planned' : ''}` : planned ? 'Activity planned' : 'Activity logged';
}

function describesPastActivity(text: string) {
	return /\b(yesterday|i går|last\s+\w+|sidste\s+\w+|went|had|was|were|did|finished|completed|trained|ran|cycled|swam|walked|hiked|meditated|worked out|exercised|gik|havde|var|gjorde|afsluttede|trænede|løb|cyklede|svømmede|vandrede|mediterede|motionerede)\b/i.test(text);
}

function derivedScore(text: string) {
	const explicit = text.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*10|out of 10)/i);
	if (explicit) return `${explicit[1]} / 10`;
	if (/terrible|severe|very bad|awful|forfærdelig|meget slemt|voldsom/i.test(text)) return '8 / 10 · Intense';
	if (/mild|little|barely|good|svag|lidt|næsten ikke|godt/i.test(text)) return '3 / 10 · Mild';
	if (/quite|noticeable|annoying|worse|tydelig|mærkbar|irriterende|værre/i.test(text)) return '6 / 10 · Noticeable';
	return '5 / 10 · Moderate';
}

function extractDate(text: string) {
	const explicit = explicitDateParts(text);
	if (!explicit || explicit.month < 0 || explicit.month > 11) return null;
	const month = MONTH_NAMES[explicit.month][0].toUpperCase() + MONTH_NAMES[explicit.month].slice(1);
	return `${month} ${explicit.day}${explicit.year ? `, ${explicit.year}` : ''}`;
}

function extractPeople(text: string) {
	const match = text.match(
		new RegExp(
			`\\b(?:with|med)\\s+(.+?)(?=,?\\s+(?:(?:(?:on|den)\\s+)?(?:${MONTHS})\\s+\\d|today|tomorrow|yesterday|i dag|i morgen|i går|next\\s+\\w+|næste\\s+\\w+)|$)`,
			'i'
		)
	);
	if (!match) return [];
	return match[1]
		.replace(/,$/, '')
		.split(/\s+(?:and|og)\s+|,\s*/i)
		.map((name) => name.trim())
		.filter(Boolean);
}

function relativeDateLabel(text: string) {
	if (/\b(?:day after tomorrow|i overmorgen)\b/i.test(text)) return 'Day after tomorrow';
	if (/\b(?:tomorrow|i morgen)\b/i.test(text)) return 'Tomorrow';
	if (/\b(?:today|i dag)\b/i.test(text)) return 'Today';
	if (/\b(?:yesterday|i går)\b/i.test(text)) return 'Yesterday';
	const weekday = text.match(new RegExp(`\\b(?:(?:next|næste)\\s+)?(?:${WEEKDAY_PATTERN})\\b`, 'i'));
	if (weekday) return weekday[0];
	const relativeAmount = text.match(new RegExp(`\\b(?:in|om)\\s+${NUMBER_TOKEN}\\s+(?:days?|dage?|weeks?|uger?)\\b`, 'i'));
	if (relativeAmount) return relativeAmount[0];
	if (/\b(?:next week|næste uge)\b/i.test(text)) return text.match(/\b(?:next week|næste uge)\b/i)?.[0] || 'Next week';
	return null;
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
	durationMinutes?: number;
	reminderMinutes?: number;
	externalProvider?: ExternalProvider;
	syncStatus: EntrySyncStatus;
};

function routeEntry(text: string, category: EntryCategory): Routing {
	const weekdayDates = extractWeekdayDates(text);
	const scheduledDates = weekdayDates.length > 1 ? weekdayDates : undefined;
	const scheduledDate = scheduledDates?.[0] || extractScheduledDate(text);
	const scheduledTime = extractScheduledTime(text);
	const explicitReminder = text.match(REMINDER_PATTERN);
	const historical = describesPastActivity(text);
	const calendarSignal = text.match(
		/\b(appointment|meeting|dinner|lunch|brunch|drinks?|concert|evening out|party|date night|reservation|flight|dentist|doctor|aftale|møde|middag|frokost|koncert|bytur|fest|date|fly|tandlæge|læge)\b/i
	);

	if (explicitReminder) {
		return {
			destination: 'Reminder',
			confidence: 'High',
			reason: `Action inferred from “${explicitReminder[1]}”`,
			 scheduledDate,
			scheduledDates,
			scheduledTime,
			reminderMinutes: 0,
			externalProvider: scheduledTime ? 'Google Calendar' : 'Google Tasks',
			syncStatus: 'Ready'
		};
	}

	if (!historical && calendarSignal && (scheduledDate || scheduledTime)) {
		return {
			destination: 'Calendar',
			confidence: 'High',
			reason: `Upcoming “${calendarSignal[1]}” with scheduling details`,
			scheduledDate,
			scheduledDates,
			scheduledTime,
			durationMinutes: 60,
			reminderMinutes: 30,
			externalProvider: 'Google Calendar',
			syncStatus: 'Ready'
		};
	}

	if (!historical && category === 'Social' && scheduledDate) {
		return {
			destination: 'Calendar',
			confidence: 'Medium',
			reason: 'Future social entry with a date',
			scheduledDate,
			scheduledDates,
			scheduledTime,
			durationMinutes: 120,
			reminderMinutes: 30,
			externalProvider: 'Google Calendar',
			syncStatus: 'Ready'
		};
	}

	if (!historical && category === 'Habit' && scheduledDate) {
		return {
			destination: 'Calendar',
			confidence: 'Medium',
			reason: 'Future habit with a scheduled date',
			scheduledDate,
			scheduledDates,
			scheduledTime,
			durationMinutes: durationMinutesFrom(text) || 60,
			reminderMinutes: 30,
			externalProvider: 'Google Calendar',
			syncStatus: 'Ready'
		};
	}

	return {
		destination: 'Timeline',
		confidence: historical ? 'High' : 'Medium',
		reason: historical ? 'Captured as something that already happened' : 'No action was explicitly requested',
		scheduledDate,
		scheduledDates,
		scheduledTime,
		syncStatus: 'Local'
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
	match('Place', /\b(restaurant|bar|café|cafe|viewpoint|museum|bakery|hotel|place|udsigtspunkt|bageri|sted)\b/i, 2);

	match('Social', /\b(meeting|dinner|lunch|drinks?|concert|evening out|party|brunch|date night|catch(?:ing)? up|møde|middag|frokost|koncert|aften ude|bytur|fest)\b/i, 3);
	match('Social', /\b(coffee|visit|meet|kaffe|besøg|mødes)\b/i, 2);
	match('Social', /\b(?:with|med)\s+[\p{L}]/iu, 1, 'with someone');

	match('Wellbeing', /\b(tinnitus|headache|migraine|mood|wellbeing|anxiety|stress|energy|pain|hovedpine|humør|velbefindende|angst|energi|smerte)\b/i, 3);
	match('Wellbeing', /\b(feel|feeling|felt|slept|sleep|føler|følelse|følte|sov|søvn)\b/i, 2);

	match('Habit', /\b(training|workout|exercise|gym|running|cycling|meditation|reading|træning|træningscenter|fitnesscenter|motion|løb|løbetur|cykling|meditation|læsning)\b/i, 3);
	match('Habit', /\b(train|trained|ran|run|cycle|cycled|swam|swim|walked|hiked|meditat(?:e|ed)|read|worked out|træne|trænede|løbe|løb|cykle|cyklede|svømme|svømmede|gåtur|gik|vandre|vandrede|meditere|mediterede|læse|læste)\b/i, 3);
	match('Habit', new RegExp(`(?:^|\\s)${NUMBER_TOKEN}\\s*(?:hours?|hrs?|minutes?|mins?|timer?|minutter?|min)(?=\\s|[,.!?]|$)`, 'i'), 1, 'duration');

	match('Reminder', /\b(appointment|dentist|doctor|deadline|aftale|tandlæge|læge|frist)\b/i, 3);
	match('Reminder', /\b(call|email|book|buy|pick up|send|pay|ring|ringe|mail|booke|køb|købe|hent|hente|send|sende|betal|betale)\b/i, 2);

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

export function interpretEntry(transcript: string): EntryDraft {
	const text = transcript.trim();
	const classification = classifyEntry(text);
	const routing = routeEntry(text, classification.category);
	const classificationMeta = {
		classificationConfidence: classification.confidence,
		classificationReason: classification.reason
	};
	const routingMeta = {
		destination: routing.destination,
		destinationConfidence: routing.confidence,
		destinationReason: routing.reason,
		scheduledDate: routing.scheduledDate,
		scheduledDates: routing.scheduledDates,
		scheduledTime: routing.scheduledTime,
		durationMinutes: routing.durationMinutes,
		reminderMinutes: routing.reminderMinutes,
		externalProvider: routing.externalProvider,
		syncStatus: routing.syncStatus,
		calendar: routing.destination === 'Calendar',
		reminder: routing.destination === 'Reminder'
	};

	if (classification.category === 'Place') {
		const named = text.match(/(?:called|named|kaldet|hedder)\s+(.+?)(?:[.!]|$)/i)?.[1];
		return {
			category: 'Place',
			title: named || 'Saved place',
			detail: /restaurant/i.test(text) ? 'Restaurant' : /bar/i.test(text) ? 'Bar' : 'Place to revisit',
			when: 'Saved now',
			transcript: text,
			...routingMeta,
			...classificationMeta
		};
	}

	if (classification.category === 'Social') {
		const people = extractPeople(text);
		const date = extractDate(text);
		const rawTitle = text.replace(/^(?:plan|log|planlæg|notér)\s+/i, '').split(/\s+(?:with|med)\s+/i)[0].trim();
		return {
			category: 'Social',
			title: rawTitle ? rawTitle[0].toUpperCase() + rawTitle.slice(1) : 'Social event',
			detail: people.length ? `With ${people.join(' & ')}` : 'Social event',
			when: date || relativeDateLabel(text) || 'Date not specified',
			transcript: text,
			people,
			status: routing.scheduledDate && !describesPastActivity(text) ? 'Planned' : describesPastActivity(text) ? 'Completed' : 'Tentative',
			...routingMeta,
			...classificationMeta
		};
	}

	if (classification.category === 'Wellbeing') {
		return {
			category: 'Wellbeing',
			title: /tinnitus/i.test(text) ? 'Tinnitus' : 'Wellbeing check-in',
			detail: derivedScore(text),
			when: 'Today',
			transcript: text,
			...routingMeta,
			...classificationMeta
		};
	}

	if (classification.category === 'Habit') {
		const planned = Boolean(routing.scheduledDate && !describesPastActivity(text));
		const title = /meditat/i.test(text)
			? 'Meditation'
			: /read|læs/i.test(text)
				? 'Reading'
				: /run|ran|løb/i.test(text)
					? 'Running'
					: 'Training';
		return {
			category: 'Habit',
			title,
			detail: durationFrom(text, planned),
			when: planned ? extractDate(text) || relativeDateLabel(text) || 'Scheduled' : /\b(?:yesterday|i går)\b/i.test(text) ? 'Yesterday' : 'Today',
			transcript: text,
			status: planned ? 'Planned' : 'Completed',
			...routingMeta,
			...classificationMeta
		};
	}

	if (classification.category === 'Reminder') {
		const action = text
			.replace(/^(?:remind me(?: to)?|remember to|don['’]?t forget(?: to)?|set (?:a |an )?reminder(?: to)?|mind mig om(?: at)?|husk at|glem ikke at|lav (?:en )?påmindelse(?: om at)?)\s*/i, '')
			.replace(new RegExp(`\\s+(?:day after tomorrow|tomorrow|today|i overmorgen|i morgen|i dag|(?:next|næste)\\s+\\w+|(?:in|om)\\s+${NUMBER_TOKEN}\\s+(?:days?|dage?|weeks?|uger?)|(?:på\\s+)?(?:${WEEKDAY_PATTERN})|(?:at|klokken|kl\\.?)\\s+\\d.*).*`, 'i'), '')
			.trim();
		const when = /\b(?:tomorrow morning|i morgen tidlig)\b/i.test(text)
			? 'Tomorrow · Morning'
			: relativeDateLabel(text) || (routing.scheduledTime ? `At ${routing.scheduledTime}` : 'Needs a time');
		return {
			category: 'Reminder',
			title: action ? action[0].toUpperCase() + action.slice(1) : 'New reminder',
			detail: 'Notification on',
			when,
			transcript: text,
			...routingMeta,
			...classificationMeta
		};
	}

	return {
		category: 'Note',
		title: text.length > 42 ? `${text.slice(0, 42)}…` : text,
		detail: 'General timeline entry',
		when: 'Today',
		transcript: text,
		...routingMeta,
		...classificationMeta
	};
}
