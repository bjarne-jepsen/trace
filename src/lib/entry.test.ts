// @ts-nocheck -- This file runs in Bun's test runtime, outside the browser bundle.
import { describe, expect, test } from 'bun:test';
import { interpretEntry } from './entry';

function localDateAfter(days: number) {
	const date = new Date();
	date.setHours(0, 0, 0, 0);
	date.setDate(date.getDate() + days);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function nextWeekday(day: number) {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	let daysAhead = (day - today.getDay() + 7) % 7;
	if (daysAhead === 0) daysAhead = 7;
	return localDateAfter(daysAhead);
}

function weekdayInNextCalendarWeek(day: number) {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const daysUntilMonday = ((8 - today.getDay()) % 7) || 7;
	const daysAfterMonday = (day + 6) % 7;
	return localDateAfter(daysUntilMonday + daysAfterMonday);
}

describe('multiple upcoming weekdays', () => {
	test('creates one concrete date for every English weekday mentioned', () => {
		const entry = interpretEntry('Going to the gym Monday, Wednesday and Saturday');
		const dates = [nextWeekday(1), nextWeekday(3), nextWeekday(6)].sort();
		expect(entry.category).toBe('Habit');
		expect(entry.destination).toBe('Calendar');
		expect(entry.scheduledDate).toBe(dates[0]);
		expect(entry.scheduledDates).toEqual(dates);
	});

	test('understands the equivalent Danish weekday list', () => {
		const entry = interpretEntry('Jeg skal i træningscenter mandag, onsdag og lørdag');
		expect(entry.category).toBe('Habit');
		expect(entry.scheduledDates).toEqual([nextWeekday(1), nextWeekday(3), nextWeekday(6)].sort());
	});

	test('applies a shared next-week qualifier to every weekday in the list', () => {
		const entry = interpretEntry('Training next week: Monday, Wednesday and Friday');
		expect(entry.scheduledDate).toBe(weekdayInNextCalendarWeek(1));
		expect(entry.scheduledDates).toEqual([
			weekdayInNextCalendarWeek(1),
			weekdayInNextCalendarWeek(3),
			weekdayInNextCalendarWeek(5)
		]);
	});

	test('applies the equivalent Danish next-week qualifier to the whole list', () => {
		const entry = interpretEntry('Træning næste uge: mandag, onsdag og fredag');
		expect(entry.scheduledDates).toEqual([
			weekdayInNextCalendarWeek(1),
			weekdayInNextCalendarWeek(3),
			weekdayInNextCalendarWeek(5)
		]);
	});
});

describe('Danish entry interpretation', () => {
	test('understands reminders in weeks and 24-hour times', () => {
		const entry = interpretEntry('Mind mig om at ringe til tandlægen om to uger klokken 14.30');
		expect(entry.category).toBe('Reminder');
		expect(entry.destination).toBe('Reminder');
		expect(entry.scheduledDate).toBe(localDateAfter(14));
		expect(entry.scheduledTime).toBe('14:30');
	});

	test('understands completed durations expressed in Danish words', () => {
		const entry = interpretEntry('Jeg trænede i halvanden time i går');
		expect(entry.category).toBe('Habit');
		expect(entry.destination).toBe('Timeline');
		expect(entry.durationMinutes).toBeUndefined();
		expect(entry.detail).toBe('90 minutes');
		expect(entry.status).toBe('Completed');
	});

	test('understands Danish weekdays, people, and spoken clock times', () => {
		const entry = interpretEntry('Middag med Michael og Jennifer næste fredag klokken atten');
		expect(entry.category).toBe('Social');
		expect(entry.destination).toBe('Calendar');
		expect(entry.scheduledTime).toBe('18:00');
		expect(entry.people).toEqual(['Michael', 'Jennifer']);
	});

	test('understands Danish day and minute units', () => {
		const entry = interpretEntry('Løb i 45 minutter i dag');
		expect(entry.category).toBe('Habit');
		expect(entry.scheduledDate).toBe(localDateAfter(0));
		expect(entry.detail).toBe('45 minutes');
	});
});

// Wednesday 30 September 2026, so weekday and year rules are tested against a fixed calendar.
const WEDNESDAY = new Date(2026, 8, 30, 12);
const read = (text: string) => interpretEntry(text, WEDNESDAY);

describe('one piece of text has one meaning', () => {
	test('a wellbeing score is never read as a date', () => {
		expect(read('My tinnitus is 7/10').scheduledDate).toBeUndefined();
		expect(read('My tinnitus is 7/10').wellbeingScore).toBe(7);
		expect(read('Tinnitus 6.5/10').scheduledDate).toBeUndefined();
		expect(read('Tinnitus 6.5/10').wellbeingScore).toBe(6.5);
	});

	test('a score format still reads as a date outside wellbeing', () => {
		expect(read('Tandlæge 7/10').scheduledDate).toBe('2026-10-07');
	});

	test('a measurement is never read as a date', () => {
		const entry = read('Trained 1.5 hours');
		expect(entry.scheduledDate).toBeUndefined();
		expect(entry.activityMinutes).toBe(90);
		expect(entry.detail).toBe('90 minutes');
	});

	test('a Danish clock time is not also a date', () => {
		const entry = read('Tandlæge kl. 10.05');
		expect(entry.scheduledDate).toBeUndefined();
		expect(entry.scheduledTime).toBe('10:05');
		expect(entry.scheduledTimeAssumed).toBeUndefined();
	});

	test('a numeric date needs a date shape to count as a date', () => {
		expect(read('Tandlæge 10.5').scheduledDate).toBe('2027-05-10');
		expect(read('Tandlæge den 10.05').scheduledDate).toBe('2027-05-10');
		expect(read('Tandlæge 10.05').scheduledDate).toBeUndefined();
	});

	test('month names win over a clock time in the same sentence', () => {
		const entry = read('Dinner 5 December at 19.30');
		expect(entry.scheduledDate).toBe('2026-12-05');
		expect(entry.scheduledTime).toBe('19:30');
	});
});

describe('tense decides which way a weekday points', () => {
	test('a past activity on a weekday is dated in the past', () => {
		const entry = read('I went running on Monday');
		expect(entry.scheduledDate).toBe('2026-09-28');
		expect(entry.destination).toBe('Timeline');
		expect(entry.status).toBe('Completed');
	});

	test('understands Danish past weekday forms', () => {
		expect(read('Jeg løb i mandags').scheduledDate).toBe('2026-09-28');
		expect(read('Sidste fredag var jeg til koncert').scheduledDate).toBe('2026-09-25');
	});

	test('a plan on a weekday is dated in the future', () => {
		const entry = read('Jeg skal løbe på mandag');
		expect(entry.scheduledDate).toBe('2026-10-05');
		expect(entry.status).toBe('Planned');
	});

	test('several past weekdays become several past dates', () => {
		expect(read('I trained Monday and Tuesday').scheduledDates).toEqual(['2026-09-28', '2026-09-29']);
	});

	test('an explicit future date outweighs a past-tense verb elsewhere in the sentence', () => {
		const entry = read('Møde med Lars i morgen kl 10 om det der var aftalt');
		expect(entry.destination).toBe('Calendar');
		expect(entry.scheduledDate).toBe('2026-10-01');
	});
});

describe('ambiguous clock times are guessed openly', () => {
	test('an evening event without am/pm is assumed to be in the evening', () => {
		const entry = read('Dinner with Anna on Friday at 7');
		expect(entry.scheduledTime).toBe('19:00');
		expect(entry.scheduledTimeAssumed).toBe(true);
		expect(entry.scheduledTimeAlternative).toBe('07:00');
		expect(entry.people).toEqual(['Anna']);
	});

	test('a morning-hour meeting stays in the morning but keeps the alternative', () => {
		const entry = read('Møde kl 9 i morgen');
		expect(entry.scheduledTime).toBe('09:00');
		expect(entry.scheduledTimeAlternative).toBe('21:00');
	});

	test('small hours are assumed to be afternoon', () => {
		expect(read('Tandlæge kl 3 på fredag').scheduledTime).toBe('15:00');
	});

	test('an unambiguous time is not marked as a guess', () => {
		const entry = read('Frokost med Mads halv et på torsdag');
		expect(entry.scheduledTime).toBe('12:30');
		expect(entry.scheduledTimeAssumed).toBeUndefined();
		expect(entry.people).toEqual(['Mads']);
		expect(read('Dinner at 19:30 on Friday').scheduledTimeAssumed).toBeUndefined();
	});

	test('an article after "at" is not an hour', () => {
		expect(read('Remind me to look at a house tomorrow').scheduledTime).toBeUndefined();
	});

	test('tonight means today in the evening', () => {
		const entry = read('Middag med Sofie i aften');
		expect(entry.scheduledDate).toBe('2026-09-30');
		expect(entry.scheduledTime).toBe('19:00');
		expect(entry.people).toEqual(['Sofie']);
	});
});

describe('readable titles', () => {
	test('habit titles match whole words only', () => {
		expect(read('Training at the grand gym tomorrow').title).toBe('Training');
		expect(read('Went swimming for 30 minutes').title).toBe('Swimming');
	});

	test('a place keeps a searchable title instead of a placeholder', () => {
		const entry = read('Found a nice barber shop');
		expect(entry.title).toBe('Nice barber shop');
		expect(entry.detail).toBe('Place to revisit');
	});

	test('a bare Danish "husk" is a reminder', () => {
		const entry = read('Husk mælk');
		expect(entry.category).toBe('Reminder');
		expect(entry.title).toBe('Mælk');
	});

	test('a reminder title keeps the words after the date', () => {
		const entry = read('Remind me to call mom tomorrow about the tickets');
		expect(entry.title).toBe('Call mom about the tickets');
		expect(entry.scheduledDate).toBe('2026-10-01');
	});

	test('a task with an upcoming date becomes a reminder', () => {
		const entry = read('Call the bank on Friday');
		expect(entry.destination).toBe('Reminder');
		expect(entry.scheduledDate).toBe('2026-10-02');
	});
});

describe('honest interpretation details', () => {
	test('does not invent a wellbeing score when none was provided', () => {
		const entry = interpretEntry('I slept badly last night');
		expect(entry.category).toBe('Wellbeing');
		expect(entry.detail).toBe('Wellbeing noted');
		expect(entry.detail).not.toMatch(/\/ 10/);
	});

	test('keeps a wellbeing score when the user explicitly provides one', () => {
		const entry = interpretEntry('My tinnitus is 7 out of 10 today');
		expect(entry.detail).toBe('7 / 10');
	});

	test('keeps an explicitly provided Danish wellbeing score', () => {
		const entry = interpretEntry('Min tinnitus er 6,5 ud af 10 i dag');
		expect(entry.detail).toBe('6.5 / 10');
	});

	test('does not claim that a local reminder will notify the user', () => {
		const entry = interpretEntry('Remind me to call Michael tomorrow');
		expect(entry.detail).toBe('Reminder saved in Trace');
		expect(entry.syncStatus).toBe('Local');
	});
});

describe('regressions found while tightening the parser', () => {
	test('a date with a slash is not a wellbeing score for an appointment', () => {
		const entry = read('Frisør 14/10 kl. 15.30');
		expect(entry.category).toBe('Reminder');
		expect(entry.scheduledDate).toBe('2026-10-14');
		expect(entry.scheduledTime).toBe('15:30');
	});

	test('a score alone does not make an entry about wellbeing', () => {
		expect(read('Frisør 7/10').category).not.toBe('Wellbeing');
	});

	test('next weekday means that weekday in next calendar week', () => {
		expect(read('Remind me next Monday at 9 to send the invoice').scheduledDate).toBe('2026-10-05');
		expect(read('Middag næste fredag').scheduledDate).toBe('2026-10-09');
		expect(read('Middag fredag').scheduledDate).toBe('2026-10-02');
	});

	test('reminder titles lose the leftover connective word', () => {
		expect(read('Remind me next Monday at 9 to send the invoice').title).toBe('Send the invoice');
		expect(read('Husk to liter mælk').title).toBe('To liter mælk');
	});

	test('a task with only a time asks for a date instead of hiding in the timeline', () => {
		const entry = read('Pick up the kids at 3');
		expect(entry.destination).toBe('Reminder');
		expect(entry.scheduledTime).toBe('15:00');
		expect(entry.scheduledDate).toBeUndefined();
	});
});
