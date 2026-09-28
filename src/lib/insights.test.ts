// @ts-nocheck -- This file runs in Bun's test runtime, outside the browser bundle.
import { describe, expect, test } from 'bun:test';
import { computeInsights } from './insights';

const TODAY = '2026-09-30';

function entry(id: string, fields: Record<string, unknown>) {
	return {
		id,
		title: id,
		detail: '',
		when: '',
		transcript: id,
		time: '09:00',
		capturedAt: '2026-09-30T07:00:00.000Z',
		destination: 'Timeline',
		category: 'Note',
		...fields
	};
}

describe('insights only count what has happened', () => {
	test('planned training does not count as exercise', () => {
		const insights = computeInsights(
			[
				entry('done', { category: 'Habit', status: 'Completed', activityMinutes: 30 }),
				entry('planned', { category: 'Habit', status: 'Planned', activityMinutes: 60, scheduledDate: '2026-09-29' })
			],
			7,
			TODAY
		);
		expect(insights.activityCount).toBe(1);
		expect(insights.activityMinutes).toBe(30);
	});

	test('future entries are left out', () => {
		const insights = computeInsights([entry('future', { scheduledDate: '2026-10-05' }), entry('now', {})], 7, TODAY);
		expect(insights.entries.map((item) => item.id)).toEqual(['now']);
	});

	test('the range decides which days count', () => {
		const old = entry('old', { scheduledDate: '2026-09-10' });
		expect(computeInsights([old], 7, TODAY).entries).toHaveLength(0);
		expect(computeInsights([old], 30, TODAY).entries).toHaveLength(1);
		expect(computeInsights([old], 'all', TODAY).entries).toHaveLength(1);
	});

	test('the chart has one bar per day in the range', () => {
		expect(computeInsights([], 7, TODAY).bars).toHaveLength(7);
		expect(computeInsights([], 30, TODAY).bars).toHaveLength(30);
		expect(computeInsights([], 7, TODAY).bars.at(-1)).toMatchObject({ key: TODAY, current: true });
	});

	test('all time shows weekly bars from the first trace', () => {
		const insights = computeInsights([entry('first', { scheduledDate: '2026-09-01' })], 'all', TODAY);
		expect(insights.bars).toHaveLength(5);
		expect(insights.bars.reduce((total, bar) => total + bar.count, 0)).toBe(1);
	});
});

describe('wellbeing scores', () => {
	test('reads structured scores and scores saved as text before scores were stored', () => {
		const insights = computeInsights(
			[
				entry('new', { category: 'Wellbeing', wellbeingScore: 4 }),
				entry('legacy', { category: 'Wellbeing', detail: '6 / 10' }),
				entry('unscored', { category: 'Wellbeing', detail: 'Tinnitus noted' })
			],
			7,
			TODAY
		);
		expect(insights.averageWellbeing).toBe(5);
		expect(insights.wellbeingCount).toBe(2);
	});

	test('reports the direction against the previous period', () => {
		const insights = computeInsights(
			[
				entry('a', { category: 'Wellbeing', wellbeingScore: 6, scheduledDate: '2026-09-29' }),
				entry('b', { category: 'Wellbeing', wellbeingScore: 4, scheduledDate: '2026-09-28' }),
				entry('c', { category: 'Wellbeing', wellbeingScore: 7, scheduledDate: '2026-09-20' }),
				entry('d', { category: 'Wellbeing', wellbeingScore: 7, scheduledDate: '2026-09-19' })
			],
			7,
			TODAY
		);
		expect(insights.stories[3]).toContain('down from 7.0');
	});
});
