<script lang="ts">
	import { onMount } from 'svelte';
	import {
		interpretEntry,
		type EntryCategory,
		type EntryDestination,
		type EntryDraft,
		type TimelineEntry
	} from '$lib/entry';
	import { deleteLocalEntry, listLocalEntries, saveLocalEntries, saveLocalEntry } from '$lib/local-entries';
	import { dateKeyAfter, describeSchedule, localDateKey, parseDateKey, relativeDayLabel } from '$lib/dates';
	import {
		INSIGHT_CATEGORIES,
		computeInsights,
		entryCaptureDateKey,
		entryDateKey,
		wellbeingScoreOf,
		type InsightRange
	} from '$lib/insights';

	type CaptureState = 'idle' | 'requesting' | 'listening' | 'processing';
	type CaptureLanguage = 'da-DK' | 'en-US';
	type ActiveTab = 'today' | 'timeline' | 'upcoming' | 'insights';
	type TimelineFilter = EntryCategory | 'All';
	type NoticeAction = 'undo' | 'capture' | null;
	type UpcomingGroup = {
		key: 'overdue' | 'today' | 'tomorrow' | 'later' | 'unscheduled';
		label: string;
		entries: TimelineEntry[];
	};
	type DraftClarification = {
		kind: 'date' | 'time';
		question: string;
		help: string;
	};
	type TraceBackup = {
		app: 'Trace';
		version: 1;
		exportedAt: string;
		entries: TimelineEntry[];
	};
	type PlaceLocationTarget = 'draft' | 'edit';
	type PlaceLocationState = 'idle' | 'requesting' | 'attached' | 'error';
	type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
	type RecognitionLike = {
		lang: string;
		continuous: boolean;
		interimResults: boolean;
		start(): void;
		stop(): void;
		abort(): void;
		onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
		onerror: ((event: { error?: string }) => void) | null;
		onend: (() => void) | null;
	};
	type RecognitionConstructor = new () => RecognitionLike;
	type SpeechWindow = Window & {
		SpeechRecognition?: RecognitionConstructor;
		webkitSpeechRecognition?: RecognitionConstructor;
	};

	const bars = [12, 20, 31, 17, 39, 24, 45, 28, 36, 18, 29, 14];
	const insightCategories = INSIGHT_CATEGORIES;
	const destinations: EntryDestination[] = ['Timeline', 'Calendar', 'Reminder'];
	const wellbeingScores = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
	// Placeholder details say nothing the category does not already say, so lists leave them out.
	const fillerDetails = new Set([
		'General timeline entry',
		'Reminder saved in Trace',
		'Activity logged',
		'Activity planned',
		'Wellbeing noted',
		'Tinnitus noted',
		'Place to revisit',
		'Social event',
		'Saved place'
	]);
	const DATE_REPAIR_KEY = 'trace-date-repair-v2';
	const legacyInferredWellbeingDetails = new Set([
		'3 / 10 · Mild',
		'5 / 10 · Moderate',
		'6 / 10 · Noticeable',
		'8 / 10 · Intense'
	]);
	const repeatCaptures = [
		{ label: 'Tinnitus', symbol: '◎', prompt: 'My tinnitus feels ' },
		{ label: 'Training', symbol: '↗', prompt: 'I trained for ' },
		{ label: 'Wellbeing', symbol: '♡', prompt: 'Today my wellbeing is ' },
		{ label: 'Reminder', symbol: '!', prompt: 'Remind me to ' }
	];

	let captureState = $state<CaptureState>('idle');
	let captureOpen = $state(false);
	let liveTranscript = $state('');
	let captureMessage = $state('');
	let manualText = $state('');
	let showManual = $state(false);
	let captureLanguage = $state<CaptureLanguage>('da-DK');
	let manualInput = $state<HTMLTextAreaElement | null>(null);
	let draft = $state<EntryDraft | null>(null);
	let editing = $state(false);
	let showDraftDetails = $state(false);
	let savingDraft = $state(false);
	let draftSaveError = $state('');
	let notice = $state('');
	let noticeAction = $state<NoticeAction>(null);
	let recentlyDeleted = $state<TimelineEntry | null>(null);
	let editingEntry = $state<TimelineEntry | null>(null);
	let editingPeople = $state('');
	let editingScore = $state('');
	let editInterpretationMessage = $state('');
	let draftTimeConfirmed = $state(false);
	let editError = $state('');
	let storagePersisted = $state<boolean | null>(null);
	let todayKey = $state(localDateKey(new Date()));
	let showDataTools = $state(false);
	let backupMessage = $state('');
	let backupError = $state('');
	let restoringBackup = $state(false);
	let lastBackupAt = $state('');
	let placeLocationState = $state<PlaceLocationState>('idle');
	let placeLocationMessage = $state('');
	let loadingEntries = $state(true);
	let timeline = $state<TimelineEntry[]>([]);
	let activeTab = $state<ActiveTab>('today');
	let insightRange = $state<InsightRange>(7);
	let timelineQuery = $state('');
	let timelineFilter = $state<TimelineFilter>('All');
	let showAllAhead = $state(false);

	let recognition: RecognitionLike | null = null;
	let stream: MediaStream | null = null;
	let recorder: MediaRecorder | null = null;
	let transcript = '';
	let recognitionPrefix = '';
	let finishing = false;
	let stopping = false;
	let stopTimeout: number | undefined;
	let restartTimeout: number | undefined;
	let noticeTimeout: number | undefined;

	const day = $derived(
		new Intl.DateTimeFormat('en-GB', { weekday: 'long', month: 'long', day: 'numeric' }).format(parseDateKey(todayKey))
	);
	const statusCopy = $derived(
		captureState === 'requesting' ? 'Opening microphone…' :
		captureState === 'listening' ? 'Listening… tap when done' :
		captureState === 'processing' ? 'Finishing capture…' :
		'Tap once, then speak naturally'
	);
	const todayEntries = $derived(timeline.filter((entry) => entryTimelineDate(entry) === todayKey));
	const todaySpineEntries = $derived([...todayEntries].sort(compareTimelineDateAscending));
	const overdueAttentionEntries = $derived(
		timeline
			.filter(
				(entry) =>
					entryTimelineDate(entry) < todayKey &&
					entry.destination === 'Reminder' &&
					entry.status !== 'Completed'
			)
			.sort(compareTimelineDateAscending)
	);
	const aheadEntries = $derived(
		timeline.filter((entry) => entryTimelineDate(entry) > todayKey).sort(compareTimelineDateAscending)
	);
	const pastEntries = $derived(
		timeline
			.filter((entry) => entryTimelineDate(entry) < todayKey && !overdueAttentionEntries.some((attention) => attention.id === entry.id))
			.sort(compareTimelineDateDescending)
	);
	const insights = $derived(computeInsights(timeline, insightRange, todayKey));
	const maxInsightBar = $derived(Math.max(1, ...insights.bars.map((bar) => bar.count)));
	const insightRangeLabel = $derived(
		insightRange === 'all' ? (insights.weeksCapped ? 'Last 26 weeks' : 'All time') : `Last ${insightRange} days`
	);
	const filteredTimeline = $derived.by(() => {
		const query = timelineQuery.trim().toLocaleLowerCase();
		return timeline.filter((entry) => {
			if (timelineFilter !== 'All' && entry.category !== timelineFilter) return false;
			if (!query) return true;
			return [
				entry.title,
				entry.detail,
				entry.transcript,
				entry.category,
				entry.destination,
				entry.placeAddress,
				entry.people?.join(' ')
			].filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
		});
	});
	const timelineGroups = $derived(groupTimelineEntries(filteredTimeline, 'desc'));
	const availableTimelineCategories = $derived(insightCategories.filter((category) => timeline.some((entry) => entry.category === category)));
	// A calendar event whose day has passed has happened; only reminders can be overdue.
	const actionableEntries = $derived.by(() =>
		timeline
			.filter(
				(entry) =>
					entry.status !== 'Completed' &&
					(entry.destination === 'Reminder' ||
						(entry.destination === 'Calendar' && (!entry.scheduledDate || entry.scheduledDate >= todayKey)))
			)
			.sort((left, right) => {
				const leftValue = `${left.scheduledDate || '9999-12-31'}T${formatClockTime(left.scheduledTime) || '23:59'}`;
				const rightValue = `${right.scheduledDate || '9999-12-31'}T${formatClockTime(right.scheduledTime) || '23:59'}`;
				return leftValue.localeCompare(rightValue);
			})
	);
	const backupDue = $derived.by(() => {
		if (timeline.length < 25) return false;
		if (!lastBackupAt) return true;
		const lastBackup = Date.parse(lastBackupAt);
		return !Number.isFinite(lastBackup) || Date.parse(`${todayKey}T23:59:59`) - lastBackup >= 14 * 24 * 60 * 60 * 1000;
	});
	const upcomingGroups = $derived.by(() => {
		const tomorrowKey = localDateAfter(1);
		const groups: UpcomingGroup[] = [
			{ key: 'overdue', label: 'Overdue', entries: [] },
			{ key: 'today', label: 'Today', entries: [] },
			{ key: 'tomorrow', label: 'Tomorrow', entries: [] },
			{ key: 'later', label: 'Later', entries: [] },
			{ key: 'unscheduled', label: 'Needs a date', entries: [] }
		];
		for (const entry of actionableEntries) {
			const groupKey = !entry.scheduledDate
				? 'unscheduled'
				: entry.scheduledDate < todayKey
					? 'overdue'
					: entry.scheduledDate === todayKey
						? 'today'
						: entry.scheduledDate === tomorrowKey
							? 'tomorrow'
							: 'later';
			groups.find((group) => group.key === groupKey)?.entries.push(entry);
		}
		return groups.filter((group) => group.entries.length > 0);
	});
	const overlayOpen = $derived(Boolean(captureOpen || draft || editingEntry || showDataTools));
	const draftWhen = $derived.by(() => {
		if (!draft) return '';
		if (draft.scheduledDates && draft.scheduledDates.length > 1) {
			return `${draft.scheduledDates.length} dates${draft.scheduledTime ? ` · ${formatClockTime(draft.scheduledTime)}` : ''}`;
		}
		if (draft.scheduledDate) return describeSchedule(draft.scheduledDate, formatClockTime(draft.scheduledTime), todayKey);
		if (draft.destination !== 'Timeline') return draft.scheduledTime ? `Date needed · ${formatClockTime(draft.scheduledTime)}` : 'Date needed';
		return `Today${draft.scheduledTime ? ` · ${formatClockTime(draft.scheduledTime)}` : ''}`;
	});
	const draftClarification = $derived.by<DraftClarification | null>(() => {
		if (!draft || draft.destination === 'Timeline') return null;
		if (!draft.scheduledDate) {
			return {
				kind: 'date',
				question: 'When should this happen?',
				help: 'A date is needed before Trace can make this actionable.'
			};
		}
		if (draft.destination === 'Calendar' && !draft.scheduledTime && !draftTimeConfirmed) {
			return {
				kind: 'time',
				question: 'Is this all-day, or should it have a time?',
				help: 'Choose a useful default now; you can still adjust it below.'
			};
		}
		return null;
	});

	function sanitizeLegacyEntry(entry: TimelineEntry) {
		let detail = entry.detail;
		if (entry.category === 'Wellbeing' && legacyInferredWellbeingDetails.has(detail)) {
			detail = /tinnitus/i.test(entry.transcript) ? 'Tinnitus noted' : 'Wellbeing noted';
		}
		if (entry.destination === 'Reminder' && detail === 'Notification on') detail = 'Reminder saved in Trace';
		if (detail === entry.detail && entry.syncStatus !== 'Ready') return entry;
		return { ...entry, detail, syncStatus: 'Local' as const };
	}

	// Timeline dates used to come straight from the parser and could not be edited, so a tinnitus score of
	// "7/10" was filed on 7 October and "went running on Monday" landed next week. Re-read those dates once
	// with the current parser, from the moment each entry was captured.
	function repairParsedDate(entry: TimelineEntry) {
		if (entry.destination !== 'Timeline' || entry.seriesId || entry.destinationConfidence === 'User selected') return entry;
		const capturedAt = new Date(entry.capturedAt);
		if (!entry.transcript.trim() || Number.isNaN(capturedAt.getTime())) return entry;
		const reread = interpretEntry(entry.transcript, capturedAt);
		if (reread.scheduledDates || (reread.scheduledDate || undefined) === (entry.scheduledDate || undefined)) return entry;
		return { ...entry, scheduledDate: reread.scheduledDate };
	}

	async function loadStoredEntries() {
		const entries = await listLocalEntries();
		const repairDates = window.localStorage.getItem(DATE_REPAIR_KEY) !== 'done';
		const sanitized = entries.map((entry) => {
			const cleaned = sanitizeLegacyEntry(entry);
			return repairDates ? repairParsedDate(cleaned) : cleaned;
		});
		if (sanitized.some((entry, index) => entry !== entries[index])) await saveLocalEntries(sanitized);
		if (repairDates) window.localStorage.setItem(DATE_REPAIR_KEY, 'done');
		timeline = sanitized;
		if (sanitized.length) void protectStorage();
	}

	// Chrome may evict site data under storage pressure unless the origin holds persistent storage.
	// Installed PWAs are usually granted it without a prompt.
	async function protectStorage() {
		if (!navigator.storage?.persist) return;
		try {
			storagePersisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
		} catch {
			storagePersisted = false;
		}
	}

	function refreshToday() {
		const key = localDateKey(new Date());
		if (key !== todayKey) todayKey = key;
	}

	onMount(() => {
		lastBackupAt = window.localStorage.getItem('trace-last-backup-at') || '';
		showManual = window.localStorage.getItem('trace-capture-method') === 'type';
		const storedLanguage = window.localStorage.getItem('trace-capture-language');
		captureLanguage = storedLanguage === 'en-US' || storedLanguage === 'da-DK'
			? storedLanguage
			: navigator.language.toLocaleLowerCase().startsWith('da') ? 'da-DK' : 'en-US';
		const launch = new URL(window.location.href);
		const captureMode = launch.searchParams.get('capture');
		const checkin = launch.searchParams.get('checkin');
		if (captureMode === 'type') showManual = true;
		if (captureMode === 'voice') showManual = false;
		if (captureMode) captureOpen = true;
		if (checkin) {
			const selected = repeatCaptures.find((item) => item.label.toLocaleLowerCase() === checkin.toLocaleLowerCase());
			if (selected) {
				showManual = true;
				manualText = selected.prompt;
				captureOpen = true;
			}
		}
		if (launch.search) window.history.replaceState(null, '', window.location.pathname);
		window.requestAnimationFrame(() => {
			if (showManual) manualInput?.focus();
		});
		void loadStoredEntries()
			.catch(() => (notice = 'Saved entries could not be opened on this device'))
			.finally(() => (loadingEntries = false));
		// An installed PWA can stay in memory overnight. Keep "Today" pointing at today.
		const clockTimer = window.setInterval(refreshToday, 60_000);
		return () => {
			window.clearInterval(clockTimer);
			if (stopTimeout !== undefined) window.clearTimeout(stopTimeout);
			if (restartTimeout !== undefined) window.clearTimeout(restartTimeout);
			if (noticeTimeout !== undefined) window.clearTimeout(noticeTimeout);
			recognition?.abort();
			stream?.getTracks().forEach((track) => track.stop());
		};
	});

	// Android's back gesture should close the open sheet, not leave the app.
	let overlayHistoryEntry = false;
	$effect(() => {
		if (overlayOpen && !overlayHistoryEntry) {
			window.history.pushState({ traceOverlay: true }, '');
			overlayHistoryEntry = true;
		} else if (!overlayOpen && overlayHistoryEntry) {
			overlayHistoryEntry = false;
			if (window.history.state?.traceOverlay) window.history.back();
		}
	});

	function handlePopState(event: PopStateEvent) {
		if (!overlayHistoryEntry || event.state?.traceOverlay) return;
		overlayHistoryEntry = false;
		closeTopOverlay();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && overlayOpen) closeTopOverlay();
	}

	function closeTopOverlay() {
		if (draft) dismissDraft();
		else if (editingEntry) closeEntryEditor();
		else if (showDataTools) showDataTools = false;
		else if (captureOpen) closeCapture();
	}

	function haptic(pattern: number | number[] = 10) {
		if ('vibrate' in navigator) navigator.vibrate(pattern);
	}

	function showToast(message: string, action: NoticeAction = null, duration = 3600) {
		if (noticeTimeout !== undefined) window.clearTimeout(noticeTimeout);
		notice = message;
		noticeAction = action;
		noticeTimeout = window.setTimeout(() => {
			notice = '';
			noticeAction = null;
			if (action === 'undo') recentlyDeleted = null;
		}, duration);
	}

	function stopHardware() {
		if (recorder?.state === 'recording') recorder.stop();
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
	}

	function processTranscript(value: string) {
		const cleaned = value.trim();
		if (!cleaned) {
			captureState = 'idle';
			showManual = false;
			captureMessage = "Chrome didn't return a transcript. Try again, or use keyboard dictation below.";
			return;
		}
		liveTranscript = cleaned;
		draftSaveError = '';
		captureState = 'processing';
		draft = interpretEntry(cleaned);
		showDraftDetails = false;
		draftTimeConfirmed = Boolean(draft.scheduledTime);
		placeLocationState = 'idle';
		placeLocationMessage = '';
		captureState = 'idle';
		liveTranscript = '';
	}

	function completeCapture(value?: string) {
		if (finishing) return;
		finishing = true;
		stopping = false;
		if (stopTimeout !== undefined) {
			window.clearTimeout(stopTimeout);
			stopTimeout = undefined;
		}
		if (restartTimeout !== undefined) {
			window.clearTimeout(restartTimeout);
			restartTimeout = undefined;
		}
		recognition?.stop();
		stopHardware();
		processTranscript(value || transcript);
		recognition = null;
		window.setTimeout(() => (finishing = false), 800);
	}

	function requestStop() {
		if (stopping || finishing) return;
		stopping = true;
		captureState = 'processing';
		stopHardware();
		if (!recognition) {
			completeCapture();
			return;
		}
		recognition.stop();
		// Mobile Chrome may deliver its final recognition result after stop() resolves.
		stopTimeout = window.setTimeout(() => completeCapture(transcript), 1800);
	}

	async function startCapture() {
		captureMessage = '';
		showManual = false;
		liveTranscript = '';
		transcript = '';
		recognitionPrefix = '';
		finishing = false;
		stopping = false;
		if (stopTimeout !== undefined) window.clearTimeout(stopTimeout);
		if (restartTimeout !== undefined) window.clearTimeout(restartTimeout);
		stopTimeout = undefined;
		restartTimeout = undefined;
		recognition = null;
		const speechWindow = window as SpeechWindow;
		const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
		if (!Recognition) {
			// Without speech recognition there is nothing to turn audio into text, so do not pretend to record.
			setCaptureMethod('type');
			captureMessage = 'This browser cannot turn speech into text. Type, or tap the microphone on your keyboard.';
			return;
		}
		captureState = 'requesting';
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
			haptic(8);
			if (typeof MediaRecorder !== 'undefined') {
				recorder = new MediaRecorder(stream);
				recorder.start();
			}
			recognition = new Recognition();
			recognition.lang = captureLanguage;
			recognition.continuous = true;
			recognition.interimResults = true;
			recognition.onresult = (event) => {
				let combined = '';
				for (let index = 0; index < event.results.length; index += 1) {
					combined += event.results[index][0].transcript;
				}
				transcript = [recognitionPrefix, combined.trim()].filter(Boolean).join(' ');
				liveTranscript = transcript;
				captureMessage = '';
			};
			recognition.onerror = (event) => {
				if (finishing || stopping || event.error === 'aborted') return;
				if (event.error === 'no-speech' || event.error === 'network') {
					captureMessage = 'Still listening… tap the microphone when you are done.';
					return;
				}
				captureMessage = 'Live transcription stopped unexpectedly. Try again, or use keyboard dictation below.';
				completeCapture();
			};
			recognition.onend = () => {
				if (finishing) return;
				if (stopping) {
					if (transcript) completeCapture(transcript);
					return;
				}
				if (captureState !== 'listening') return;
				recognitionPrefix = transcript.trim();
				restartTimeout = window.setTimeout(() => {
					if (!recognition || captureState !== 'listening' || stopping || finishing) return;
					try {
						recognition.start();
					} catch {
						captureMessage = 'Speech recognition paused. Tap the microphone to finish this entry.';
					}
				}, 180);
			};
			recognition.start();
			captureState = 'listening';
		} catch {
			captureState = 'idle';
			captureMessage = 'Microphone access is needed. Allow it and try again, or use keyboard dictation below.';
			showManual = false;
		}
	}

	function handleMic() {
		if (captureState === 'idle') void startCapture();
		else if (captureState === 'listening') {
			haptic([8, 35, 8]);
			requestStop();
		}
	}

	function openCapture(method?: 'voice' | 'type') {
		if (method && captureState === 'idle') setCaptureMethod(method);
		captureOpen = true;
		if (showManual) window.requestAnimationFrame(() => manualInput?.focus());
	}

	function closeCapture() {
		if (captureState === 'processing') return;
		finishing = true;
		recognition?.abort();
		recognition = null;
		stopHardware();
		captureState = 'idle';
		liveTranscript = '';
		captureOpen = false;
		captureMessage = '';
		window.setTimeout(() => (finishing = false), 200);
	}

	function setCaptureMethod(method: 'voice' | 'type') {
		if (captureState !== 'idle') return;
		captureMessage = '';
		showManual = method === 'type';
		window.localStorage.setItem('trace-capture-method', method);
		if (showManual) window.requestAnimationFrame(() => manualInput?.focus());
	}

	function setCaptureLanguage(language: CaptureLanguage) {
		if (captureState !== 'idle') return;
		captureLanguage = language;
		window.localStorage.setItem('trace-capture-language', language);
	}

	function startRepeatCapture(prompt: string) {
		if (captureState !== 'idle') return;
		captureOpen = true;
		showManual = true;
		manualText = prompt;
		window.localStorage.setItem('trace-capture-method', 'type');
		window.scrollTo({ top: 0, behavior: 'smooth' });
		window.requestAnimationFrame(() => {
			manualInput?.focus();
			manualInput?.setSelectionRange(prompt.length, prompt.length);
		});
	}

	function tryExample(value: string, keepTypedCapture = false) {
		captureMessage = '';
		draftSaveError = '';
		showManual = keepTypedCapture;
		liveTranscript = value;
		captureState = 'processing';
		draft = interpretEntry(value);
		showDraftDetails = false;
		draftTimeConfirmed = Boolean(draft.scheduledTime);
		placeLocationState = 'idle';
		placeLocationMessage = '';
		liveTranscript = '';
		captureState = 'idle';
	}

	function submitManual(event: Event) {
		event.preventDefault();
		if (!manualText.trim()) return;
		const value = manualText.trim();
		manualText = '';
		tryExample(value, true);
	}

	function markDraftCategorySelected() {
		if (!draft) return;
		draft.classificationConfidence = 'User selected';
		draft.classificationReason = 'Category changed during confirmation';
	}

	function setDraftDestination(destination: EntryDestination) {
		if (!draft) return;
		draft.destination = destination;
		draft.destinationConfidence = 'User selected';
		draft.destinationReason = 'Action changed during confirmation';
		draft.calendar = destination === 'Calendar';
		draft.reminder = destination === 'Reminder';
		draft.syncStatus = 'Local';
		if (destination === 'Calendar') {
			draft.externalProvider = 'Google Calendar';
			draft.durationMinutes ??= 60;
			draft.reminderMinutes ??= 30;
			draftTimeConfirmed = Boolean(draft.scheduledTime);
		} else if (destination === 'Reminder') {
			draft.externalProvider = draft.scheduledTime ? 'Google Calendar' : 'Google Tasks';
			draft.reminderMinutes = 0;
			draftTimeConfirmed = true;
		} else {
			draft.externalProvider = undefined;
			draftTimeConfirmed = true;
		}
	}

	function updateDraftProvider() {
		if (!draft || draft.destination !== 'Reminder') return;
		draft.externalProvider = draft.scheduledTime ? 'Google Calendar' : 'Google Tasks';
	}

	function mapsSearchUrl(entry: EntryDraft) {
		const queryParts = [entry.title.trim(), entry.placeAddress?.trim()].filter(Boolean);
		if (!entry.placeAddress && entry.latitude !== undefined && entry.longitude !== undefined) {
			queryParts.push(`${entry.latitude},${entry.longitude}`);
		}
		const parameters = new URLSearchParams({ api: '1', query: queryParts.join(', ') || 'Nearby places' });
		if (entry.googlePlaceId) parameters.set('query_place_id', entry.googlePlaceId);
		parameters.set('utm_source', 'trace');
		parameters.set('utm_campaign', 'place_details_search');
		return `https://www.google.com/maps/search/?${parameters.toString()}`;
	}

	function mapsPinUrl(entry: EntryDraft) {
		if (entry.latitude === undefined || entry.longitude === undefined) return undefined;
		const parameters = new URLSearchParams({
			api: '1',
			query: `${entry.latitude},${entry.longitude}`,
			utm_source: 'trace',
			utm_campaign: 'location_sharing'
		});
		return `https://www.google.com/maps/search/?${parameters.toString()}`;
	}

	function refreshPlaceLinks(entry: EntryDraft) {
		if (entry.category !== 'Place') {
			entry.mapsSearchUrl = undefined;
			entry.mapsPinUrl = undefined;
			return;
		}
		entry.mapsSearchUrl = mapsSearchUrl(entry);
		entry.mapsPinUrl = mapsPinUrl(entry);
	}

	function placeLocationTarget(target: PlaceLocationTarget) {
		return target === 'draft' ? draft : editingEntry;
	}

	function attachCurrentLocation(target: PlaceLocationTarget) {
		const place = placeLocationTarget(target);
		if (!place || place.category !== 'Place') return;
		placeLocationMessage = '';
		if (!navigator.geolocation) {
			placeLocationState = 'error';
			placeLocationMessage = 'Location is not available in this browser.';
			return;
		}
		placeLocationState = 'requesting';
		navigator.geolocation.getCurrentPosition(
			(position) => {
				const current = placeLocationTarget(target);
				if (!current || current.category !== 'Place') return;
				current.latitude = Number(position.coords.latitude.toFixed(6));
				current.longitude = Number(position.coords.longitude.toFixed(6));
				current.locationAccuracy = Math.round(position.coords.accuracy);
				current.locationCapturedAt = new Date(position.timestamp).toISOString();
				refreshPlaceLinks(current);
				placeLocationState = 'attached';
				placeLocationMessage = `Current position attached${current.locationAccuracy ? ` · accurate to about ${current.locationAccuracy} m` : ''}.`;
			},
			(error) => {
				placeLocationState = 'error';
				placeLocationMessage = error.code === error.PERMISSION_DENIED
					? 'Location permission was not granted. You can still save and search by name.'
					: 'Trace could not get your current position. Try again somewhere with a clearer signal.';
			},
			{ enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
		);
	}

	function removePlaceLocation(target: PlaceLocationTarget) {
		const place = placeLocationTarget(target);
		if (!place) return;
		place.latitude = undefined;
		place.longitude = undefined;
		place.locationAccuracy = undefined;
		place.locationCapturedAt = undefined;
		place.mapsPinUrl = undefined;
		refreshPlaceLinks(place);
		placeLocationState = 'idle';
		placeLocationMessage = '';
	}

	function localDateAfter(days: number) {
		return dateKeyAfter(days, parseDateKey(todayKey));
	}

	function entryTimelineDate(entry: TimelineEntry) {
		return entryDateKey(entry);
	}

	function compareTimelineDateAscending(left: TimelineEntry, right: TimelineEntry) {
		const leftValue = `${entryTimelineDate(left)}T${formatClockTime(left.scheduledTime || left.time) || '23:59'}`;
		const rightValue = `${entryTimelineDate(right)}T${formatClockTime(right.scheduledTime || right.time) || '23:59'}`;
		return leftValue.localeCompare(rightValue);
	}

	function compareTimelineDateDescending(left: TimelineEntry, right: TimelineEntry) {
		return compareTimelineDateAscending(right, left);
	}

	function groupTimelineEntries(entries: TimelineEntry[], direction: 'asc' | 'desc') {
		const nearby = new Set([localDateAfter(-1), todayKey, localDateAfter(1)]);
		const formatter = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
		const groups = new Map<string, TimelineEntry[]>();
		for (const entry of entries) {
			const key = entryTimelineDate(entry);
			groups.set(key, [...(groups.get(key) || []), entry]);
		}
		return [...groups.entries()]
			.sort(([left], [right]) => direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left))
			.map(([key, groupedEntries]) => ({
				key,
				label: nearby.has(key) ? relativeDayLabel(key, todayKey) : formatter.format(parseDateKey(key)),
				entries: [...groupedEntries].sort(direction === 'asc' ? compareTimelineDateAscending : compareTimelineDateDescending)
			}));
	}

	function setDraftRelativeDate(days: number, label: string) {
		if (!draft) return;
		draft.scheduledDate = localDateAfter(days);
		draft.scheduledDates = undefined;
		draft.when = label;
		draftSaveError = '';
	}

	function updateDraftOccurrence(index: number, value: string) {
		if (!draft?.scheduledDates || !value) return;
		const dates = [...draft.scheduledDates];
		dates[index] = value;
		draft.scheduledDates = [...new Set(dates)].sort();
		draft.scheduledDate = draft.scheduledDates[0];
		draftSaveError = '';
	}

	function removeDraftOccurrence(index: number) {
		if (!draft?.scheduledDates || draft.scheduledDates.length <= 1) return;
		const dates = draft.scheduledDates.filter((_, dateIndex) => dateIndex !== index);
		draft.scheduledDates = dates.length > 1 ? dates : undefined;
		draft.scheduledDate = dates[0];
		draftSaveError = '';
	}

	function setDraftTime(value: string) {
		if (!draft) return;
		draft.scheduledTime = value;
		draft.eventTime = value;
		draft.scheduledTimeAssumed = undefined;
		draft.scheduledTimeAlternative = undefined;
		draftTimeConfirmed = true;
		updateDraftProvider();
	}

	function useAlternativeTime() {
		if (draft?.scheduledTimeAlternative) setDraftTime(draft.scheduledTimeAlternative);
	}

	function setDraftScore(score: number) {
		if (!draft) return;
		const clearing = draft.wellbeingScore === score;
		draft.wellbeingScore = clearing ? undefined : score;
		draft.detail = clearing ? (/tinnitus/i.test(draft.transcript) ? 'Tinnitus noted' : 'Wellbeing noted') : `${score} / 10`;
	}

	// Closing the confirmation goes back to the capture sheet with the text intact, so rephrasing is one step.
	function dismissDraft() {
		if (!draft) return;
		const typed = showManual;
		if (typed) manualText = draft.transcript;
		draft = null;
		editing = false;
		showDraftDetails = false;
		draftSaveError = '';
		if (typed) window.requestAnimationFrame(() => manualInput?.focus());
	}

	function closeEntryEditor() {
		editingEntry = null;
		editError = '';
		editInterpretationMessage = '';
	}

	function isBackupEntry(value: unknown): value is TimelineEntry {
		if (!value || typeof value !== 'object') return false;
		const entry = value as Record<string, unknown>;
		return (
			typeof entry.id === 'string' &&
			typeof entry.category === 'string' &&
			insightCategories.includes(entry.category as EntryCategory) &&
			typeof entry.title === 'string' &&
			typeof entry.detail === 'string' &&
			typeof entry.when === 'string' &&
			typeof entry.transcript === 'string' &&
			typeof entry.time === 'string' &&
			typeof entry.capturedAt === 'string' &&
			!Number.isNaN(Date.parse(entry.capturedAt))
		);
	}

	function exportBackup() {
		backupError = '';
		const exportedAt = new Date().toISOString();
		const backup: TraceBackup = {
			app: 'Trace',
			version: 1,
			exportedAt,
			entries: timeline
		};
		const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `trace-backup-${exportedAt.slice(0, 10)}.json`;
		link.style.display = 'none';
		document.body.append(link);
		link.click();
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
		lastBackupAt = exportedAt;
		window.localStorage.setItem('trace-last-backup-at', exportedAt);
		backupMessage = `${timeline.length} ${timeline.length === 1 ? 'entry' : 'entries'} exported.`;
	}

	async function restoreBackup(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		backupError = '';
		backupMessage = '';
		if (file.size > 5 * 1024 * 1024) {
			backupError = 'That backup is too large for Trace to restore safely.';
			input.value = '';
			return;
		}
		restoringBackup = true;
		try {
			const parsed = JSON.parse(await file.text()) as unknown;
			const candidate = Array.isArray(parsed)
				? parsed
				: parsed && typeof parsed === 'object' && Array.isArray((parsed as { entries?: unknown }).entries)
					? (parsed as { entries: unknown[] }).entries
					: null;
			if (!candidate || candidate.length > 10000 || !candidate.every(isBackupEntry)) {
				throw new Error('Invalid Trace backup');
			}
			await saveLocalEntries(candidate);
			timeline = await listLocalEntries();
			backupMessage = `${candidate.length} ${candidate.length === 1 ? 'entry' : 'entries'} merged into this device.`;
		} catch {
			backupError = 'Trace could not read that backup. Choose an unmodified Trace JSON backup.';
		} finally {
			restoringBackup = false;
			input.value = '';
		}
	}

	function formatLastBackup() {
		if (!lastBackupAt) return 'No backup created yet';
		const date = new Date(lastBackupAt);
		if (Number.isNaN(date.getTime())) return 'No backup created yet';
		return `Last backup ${formatDateTime24(date)}`;
	}

	function openDataTools() {
		showDataTools = true;
		backupMessage = '';
		backupError = '';
	}

	function formatClockTime(value?: string) {
		if (!value) return '';
		const cleaned = value.trim().replace(/\./g, '');
		const meridiem = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
		if (meridiem) {
			let hour = Number(meridiem[1]) % 12;
			if (meridiem[3].toLowerCase() === 'pm') hour += 12;
			return `${String(hour).padStart(2, '0')}:${meridiem[2] || '00'}`;
		}
		const twentyFourHour = cleaned.match(/^(\d{1,2}):(\d{2})/);
		if (twentyFourHour) return `${String(Number(twentyFourHour[1])).padStart(2, '0')}:${twentyFourHour[2]}`;
		return value;
	}

	function formatDateTime24(value: Date | string) {
		const date = value instanceof Date ? value : new Date(value);
		if (Number.isNaN(date.getTime())) return String(value);
		return new Intl.DateTimeFormat('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		}).format(date);
	}

	function formatScheduledDate(value?: string) {
		if (!value) return 'Date needed';
		const date = new Date(`${value}T12:00:00`);
		if (Number.isNaN(date.getTime())) return value;
		return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
	}

	function formatSpineDate(entry: TimelineEntry) {
		const value = entryTimelineDate(entry);
		const date = new Date(`${value}T12:00:00`);
		if (Number.isNaN(date.getTime())) return value;
		return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit' }).format(date).toUpperCase();
	}

	function formatSpineTime(entry: TimelineEntry) {
		return formatClockTime(entry.scheduledTime || entry.time) || '—';
	}

	function entryDetail(entry: TimelineEntry) {
		return fillerDetails.has(entry.detail) ? '' : entry.detail;
	}

	/** The time (when asked) and any detail that says more than the category does. Lists show the day elsewhere. */
	function entrySummary(entry: TimelineEntry, showTime = true) {
		return [showTime && entry.scheduledTime ? formatClockTime(entry.scheduledTime) : '', entryDetail(entry)]
			.filter(Boolean)
			.join(' · ');
	}

	function showsDestination(entry: TimelineEntry) {
		return entry.destination !== 'Timeline' && entry.destination !== entry.category;
	}

	async function confirmDraft() {
		if (!draft || savingDraft) return;
		draftSaveError = '';
		if (!draft.title.trim() || !draft.detail.trim()) {
			draftSaveError = 'Add a title and details before saving.';
			return;
		}
		if (draft.destination !== 'Timeline' && !draft.scheduledDate) {
			draftSaveError = `Add a date before routing this to ${draft.destination}.`;
			return;
		}
		if (draft.destination !== 'Timeline' && !draft.status) draft.status = 'Planned';
		draft.scheduledDate = draft.scheduledDate || undefined;
		draft.scheduledTime = draft.scheduledTime || undefined;
		draft.calendar = draft.destination === 'Calendar';
		draft.reminder = draft.destination === 'Reminder';
		draft.eventTime = draft.scheduledTime;
		draft.syncStatus = 'Local';
		draft.externalProvider = draft.destination === 'Calendar'
			? 'Google Calendar'
			: draft.destination === 'Reminder'
				? (draft.scheduledTime ? 'Google Calendar' : 'Google Tasks')
				: undefined;
		if (draft.category === 'Place') {
			draft.placeAddress = draft.placeAddress?.trim() || undefined;
			refreshPlaceLinks(draft);
		}
		savingDraft = true;
		const now = new Date();
		const occurrenceDates = draft.scheduledDates?.length ? [...new Set(draft.scheduledDates)].sort() : [draft.scheduledDate];
		const datesToSave = occurrenceDates.filter((date): date is string => Boolean(date));
		const seriesId = datesToSave.length > 1 ? crypto.randomUUID() : undefined;
		const { scheduledDates: _scheduledDates, ...draftFields } = draft;
		const entries: TimelineEntry[] = (datesToSave.length ? datesToSave : [undefined]).map((scheduledDate, index) => ({
			...draftFields,
			scheduledDate,
			when: scheduledDate ? `${formatScheduledDate(scheduledDate)}${draftFields.scheduledTime ? ` at ${draftFields.scheduledTime}` : ''}` : 'Captured',
			seriesId,
			occurrenceIndex: seriesId ? index : undefined,
			occurrenceCount: seriesId ? datesToSave.length : undefined,
			id: crypto.randomUUID(),
			time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
			capturedAt: new Date(now.getTime() + index).toISOString()
		}));
		try {
			await saveLocalEntries(entries);
			timeline = [...entries, ...timeline];
			if (storagePersisted !== true) void protectStorage();
			draft = null;
			captureOpen = false;
			editing = false;
			showDraftDetails = false;
			haptic([10, 35, 18]);
			showToast(
				entries.length > 1
					? `${entries.length} traces saved`
					: entries[0].destination === 'Timeline' ? `${entries[0].category} saved` : 'Plan saved in Trace',
				'capture',
				5200
			);
		} catch {
			draftSaveError = 'That entry could not be saved. Please try again.';
		} finally {
			savingDraft = false;
		}
	}

	async function deleteEntryWithUndo(entry: TimelineEntry) {
		try {
			await deleteLocalEntry(entry.id);
			timeline = timeline.filter((item) => item.id !== entry.id);
			recentlyDeleted = entry;
			haptic(12);
			showToast('Entry deleted', 'undo', 6000);
		} catch {
			showToast('That entry could not be deleted');
		}
	}

	async function undoDelete() {
		if (!recentlyDeleted) return;
		const entry = recentlyDeleted;
		try {
			await saveLocalEntry(entry);
			timeline = [...timeline, entry].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
			recentlyDeleted = null;
			haptic([8, 28, 12]);
			showToast('Entry restored');
		} catch {
			showToast('That entry could not be restored');
		}
	}

	function beginAnotherCapture() {
		if (noticeTimeout !== undefined) window.clearTimeout(noticeTimeout);
		notice = '';
		noticeAction = null;
		activeTab = 'today';
		captureOpen = true;
		window.scrollTo({ top: 0, behavior: 'smooth' });
		if (showManual) window.requestAnimationFrame(() => manualInput?.focus());
	}

	function beginEntryEdit(entry: TimelineEntry) {
		editingEntry = {
			...entry,
			people: entry.people ? [...entry.people] : undefined,
			eventTime: entry.eventTime || '',
			scheduledDate: entry.scheduledDate || '',
			scheduledTime: formatClockTime(entry.scheduledTime || entry.eventTime)
		};
		editingPeople = entry.people?.join(', ') || '';
		editingScore = String(wellbeingScoreOf(entry) ?? '');
		editInterpretationMessage = '';
		editError = '';
		placeLocationState = entry.latitude !== undefined && entry.longitude !== undefined ? 'attached' : 'idle';
		placeLocationMessage = entry.latitude !== undefined && entry.longitude !== undefined
			? `Position attached${entry.locationAccuracy ? ` · accurate to about ${entry.locationAccuracy} m` : ''}.`
			: '';
	}

	function reinterpretEditedCapture() {
		if (!editingEntry?.transcript.trim()) return;
		const current = editingEntry;
		const interpreted = interpretEntry(current.transcript.trim());
		const occurrenceDate = interpreted.scheduledDates?.[current.occurrenceIndex || 0] || interpreted.scheduledDate;
		const { scheduledDates: _scheduledDates, ...singleOccurrence } = interpreted;
		editingEntry = {
			...current,
			...singleOccurrence,
			id: current.id,
			time: current.time,
			capturedAt: current.capturedAt,
			scheduledDate: occurrenceDate || '',
			scheduledTime: interpreted.scheduledTime || '',
			eventTime: interpreted.scheduledTime || '',
			status: interpreted.status || (interpreted.destination !== 'Timeline' ? 'Planned' : undefined)
		};
		editingPeople = interpreted.people?.join(', ') || '';
		editingScore = String(interpreted.wellbeingScore ?? '');
		editInterpretationMessage = 'Capture reinterpreted. Review the updated fields below.';
	}

	async function saveEditedEntry(event: SubmitEvent) {
		event.preventDefault();
		if (!editingEntry) return;
		const original = timeline.find((entry) => entry.id === editingEntry?.id);
		const categoryChanged = original?.category !== editingEntry.category;
		const scheduledDate = editingEntry.scheduledDate || undefined;
		const scheduledTime = editingEntry.scheduledTime || undefined;
		const timeChanged = scheduledTime !== (original?.scheduledTime || undefined);
		const score = editingEntry.category === 'Wellbeing' && editingScore !== '' ? Number(editingScore) : undefined;
		const scoreShaped = /^\d+(?:\.\d+)?\s*\/\s*10$/.test(editingEntry.detail.trim()) || fillerDetails.has(editingEntry.detail.trim());
		const detail =
			editingEntry.category === 'Wellbeing' && scoreShaped && score !== (original ? wellbeingScoreOf(original) : undefined)
				? score !== undefined
					? `${score} / 10`
					: /tinnitus/i.test(editingEntry.transcript) ? 'Tinnitus noted' : 'Wellbeing noted'
				: editingEntry.detail.trim();
		const updated: TimelineEntry = {
			...editingEntry,
			title: editingEntry.title.trim(),
			detail,
			scheduledDate,
			scheduledTime,
			scheduledTimeAssumed: timeChanged ? undefined : editingEntry.scheduledTimeAssumed,
			scheduledTimeAlternative: timeChanged ? undefined : editingEntry.scheduledTimeAlternative,
			wellbeingScore: score,
			when: scheduledDate ? `${formatScheduledDate(scheduledDate)}${scheduledTime ? ` at ${scheduledTime}` : ''}` : 'Captured',
			people: editingEntry.category === 'Social'
				? editingPeople.split(/,|\band\b/i).map((person) => person.trim()).filter(Boolean)
				: undefined,
			classificationConfidence: categoryChanged ? 'User selected' : editingEntry.classificationConfidence,
			classificationReason: categoryChanged ? 'Category changed after capture' : editingEntry.classificationReason,
			calendar: editingEntry.destination === 'Calendar',
			reminder: editingEntry.destination === 'Reminder',
			eventTime: scheduledTime,
			externalProvider: editingEntry.destination === 'Calendar'
				? 'Google Calendar'
				: editingEntry.destination === 'Reminder'
					? (scheduledTime ? 'Google Calendar' : 'Google Tasks')
					: undefined,
			syncStatus: 'Local'
		};
		if (updated.category === 'Place') {
			updated.placeAddress = updated.placeAddress?.trim() || undefined;
			refreshPlaceLinks(updated);
		} else {
			updated.placeAddress = undefined;
			updated.latitude = undefined;
			updated.longitude = undefined;
			updated.locationAccuracy = undefined;
			updated.locationCapturedAt = undefined;
			updated.googlePlaceId = undefined;
			updated.mapsSearchUrl = undefined;
			updated.mapsPinUrl = undefined;
		}
		editError = !updated.title
			? 'Add a title before saving.'
			: !updated.detail
				? 'Add details before saving.'
				: updated.destination !== 'Timeline' && !updated.scheduledDate
					? `Add a date, or choose Timeline instead of ${updated.destination}.`
					: '';
		if (editError) return;
		try {
			await saveLocalEntry(updated);
			timeline = timeline.map((entry) => (entry.id === updated.id ? updated : entry));
			closeEntryEditor();
			showToast('Entry updated');
		} catch {
			editError = 'That entry could not be saved. Please try again.';
		}
	}

	async function completeReminder(entry: TimelineEntry) {
		if (entry.destination !== 'Reminder') return;
		const updated: TimelineEntry = {
			...entry,
			status: 'Completed',
			syncStatus: 'Local'
		};
		try {
			await saveLocalEntry(updated);
			timeline = timeline.map((item) => (item.id === updated.id ? updated : item));
			showToast('Reminder completed');
		} catch {
			showToast('That reminder could not be completed');
		}
	}

	function showToday() {
		activeTab = 'today';
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function showTimeline() {
		activeTab = 'timeline';
		window.scrollTo({ top: 0 });
	}

	function showInsights() {
		activeTab = 'insights';
	}

	function showUpcoming() {
		activeTab = 'upcoming';
	}
</script>

{#snippet entryMenu(entry: TimelineEntry, extraClass = '')}
	<details class={`entry-menu ${extraClass}`}><summary aria-label={`More actions for ${entry.title}`}>•••</summary><div><button type="button" onclick={() => beginEntryEdit(entry)}>Edit</button>{#if entry.destination === 'Reminder' && entry.status !== 'Completed'}<button type="button" onclick={() => completeReminder(entry)}>Mark done</button>{/if}<button class="danger" type="button" onclick={() => deleteEntryWithUndo(entry)}>Delete</button></div></details>
{/snippet}

{#snippet placeLinks(entry: TimelineEntry, extraClass = '')}
	{#if entry.category === 'Place'}<div class={`place-map-actions ${extraClass}`}><a href={entry.mapsSearchUrl || mapsSearchUrl(entry)} target="_blank" rel="noreferrer"><span>↗</span>Find in Maps</a>{#if entry.latitude !== undefined && entry.longitude !== undefined}<a href={entry.mapsPinUrl || mapsPinUrl(entry)} target="_blank" rel="noreferrer"><span>⌖</span>Captured pin</a>{/if}</div>{/if}
{/snippet}

{#snippet traceCard(entry: TimelineEntry)}
	<article class="timeline-item">
		<button class="timeline-entry-open" type="button" onclick={() => beginEntryEdit(entry)} aria-label={`Open ${entry.transcript}`}>
			<span class={`category-dot ${entry.category.toLowerCase()}`}></span>
			<span class="timeline-copy"><span class="timeline-meta"><span>{entry.category}</span>{#if showsDestination(entry)}<span class={`route-badge ${entry.destination.toLowerCase()}`}>{entry.destination}</span>{/if}<time>{formatSpineTime(entry)}</time></span><strong>{entry.transcript}</strong>{#if entrySummary(entry, false)}<span class="timeline-description">{entrySummary(entry, false)}</span>{/if}</span>
			<span class="timeline-chevron" aria-hidden="true">›</span>
		</button>
		{@render entryMenu(entry)}
		{@render placeLinks(entry)}
	</article>
{/snippet}

{#snippet spineTrace(entry: TimelineEntry, context: 'today' | 'ahead' | 'attention')}
	<article class={`spine-trace ${context}`}>
		<div class="spine-when">
			{#if context === 'today'}<time>{formatSpineTime(entry)}</time>{:else}<time>{formatSpineDate(entry)}</time>{/if}
		</div>
		<div class="spine-trace-body">
			<span class={`spine-dot ${entry.category.toLowerCase()}`} aria-hidden="true"></span>
			<button class="spine-trace-open" type="button" onclick={() => beginEntryEdit(entry)} aria-label={`Open ${entry.transcript}`}>
				<strong>{entry.transcript}</strong>
				{#if entrySummary(entry, context !== 'today')}<span>{entrySummary(entry, context !== 'today')}</span>{/if}
				<small><i class={`category-dot ${entry.category.toLowerCase()}`}></i>{entry.category.toUpperCase()}{showsDestination(entry) ? ` · ${entry.destination.toUpperCase()}` : ''}</small>
			</button>
			{@render entryMenu(entry, 'spine-menu')}
			{@render placeLinks(entry, 'spine-map-actions')}
		</div>
	</article>
{/snippet}

<svelte:window onpopstate={handlePopState} onkeydown={handleKeydown} onfocus={refreshToday} />
<svelte:document onvisibilitychange={() => { if (document.visibilityState === 'visible') refreshToday(); }} />

<svelte:head>
	<title>Trace — Personal timeline</title>
	<meta name="description" content="Capture wellbeing, reminders, habits, places, and everyday moments in one personal timeline." />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="default" />
	<meta name="apple-mobile-web-app-title" content="Trace" />
</svelte:head>

<main class="app-shell">
	<section class="phone-stage" aria-label="Trace personal timeline">
		<header class="trace-header">
			<div><p>{day} · On this device</p><h1>What’s happening?</h1></div>
			<button class="avatar data-button" type="button" onclick={openDataTools} aria-label="Open Trace data and backup tools">Data</button>
		</header>

		<nav class="trace-tabs" aria-label="Trace sections">
			<button class:active={activeTab === 'today'} aria-current={activeTab === 'today' ? 'page' : undefined} type="button" onclick={showToday}>Today</button>
			<button class:active={activeTab === 'upcoming'} aria-current={activeTab === 'upcoming' ? 'page' : undefined} type="button" onclick={showUpcoming}>Plans{#if actionableEntries.length}<span aria-label={`${actionableEntries.length} open`}>{actionableEntries.length}</span>{/if}</button>
			<button class:active={activeTab === 'timeline'} aria-current={activeTab === 'timeline' ? 'page' : undefined} type="button" onclick={showTimeline}>Archive</button>
			<button class:active={activeTab === 'insights'} aria-current={activeTab === 'insights' ? 'page' : undefined} type="button" onclick={showInsights}>Insights</button>
		</nav>

		{#if captureOpen && !draft}
		<div class="capture-sheet-backdrop" role="presentation">
			<section class="capture-sheet" aria-label="Quick capture">
				<header><span>Quick capture</span><button type="button" onclick={closeCapture} disabled={captureState === 'processing'}>Close</button></header>
		<div class="capture-methods" aria-label="Choose a capture method">
			<button type="button" class:active={!showManual} onclick={() => setCaptureMethod('voice')} disabled={captureState !== 'idle'} aria-pressed={!showManual}><span class="voice-method-icon" aria-hidden="true"><i></i></span>Speak</button>
			<button type="button" class:active={showManual} onclick={() => setCaptureMethod('type')} disabled={captureState !== 'idle'} aria-pressed={showManual}><span aria-hidden="true">⌨</span>Type or dictate</button>
		</div>
		<div class="capture-language" aria-label="Voice recognition language">
			<span>Voice language</span>
			<div><button type="button" class:active={captureLanguage === 'da-DK'} onclick={() => setCaptureLanguage('da-DK')} disabled={captureState !== 'idle'} aria-pressed={captureLanguage === 'da-DK'}>Dansk</button><button type="button" class:active={captureLanguage === 'en-US'} onclick={() => setCaptureLanguage('en-US')} disabled={captureState !== 'idle'} aria-pressed={captureLanguage === 'en-US'}>English</button></div>
		</div>

		<section class:listening={captureState === 'listening'} class:typing={showManual} class="capture-card" aria-live="polite">
			<div class="ambient ambient-one"></div><div class="ambient ambient-two"></div>
			{#if showManual}
				<form class="typed-capture" onsubmit={submitManual}>
					<div class="capture-readout"><span>Type or dictate</span><p>Write naturally, or tap the microphone on your keyboard.</p></div>
					<label for="manual-text">What would you like to capture?</label>
					<textarea id="manual-text" bind:this={manualInput} bind:value={manualText} rows="5" placeholder="Type here, or use your keyboard microphone…" disabled={captureState === 'processing'}></textarea>
					<div class="typed-capture-actions"><small>You can review everything before it is saved.</small><button type="submit" disabled={!manualText.trim() || captureState === 'processing'}>{#if captureState === 'processing'}<span class="spinner light"></span>{:else}Interpret <span aria-hidden="true">→</span>{/if}</button></div>
				</form>
			{:else}
				<div class="capture-content">
					<div class="capture-readout">
						{#if liveTranscript}<p class="live-transcript">“{liveTranscript}”</p>{:else}<span>Quick capture</span><p>{statusCopy}</p>{/if}
					</div>
					<div class="mic-wrap">
						<i class="pulse one"></i><i class="pulse two"></i>
						<button type="button" class="mic-button" onclick={handleMic} disabled={captureState === 'requesting' || captureState === 'processing'} aria-label={captureState === 'listening' ? 'Stop recording' : 'Start voice capture'}>
							{#if captureState === 'processing'}<span class="spinner"></span>{:else}<span class="mic-glyph"><i></i><b></b><em></em></span>{/if}
						</button>
					</div>
					<div class:active={captureState === 'listening'} class="waveform" aria-hidden="true">{#each bars as height}<i style:height={`${height}px`}></i>{/each}</div>
				</div>
			{/if}
		</section>

		{#if captureMessage}
			<div class="capture-feedback">
				<p class="capture-message">{captureMessage}</p>
				{#if captureState === 'idle' && !showManual}
					<button class="keyboard-dictation" type="button" onclick={() => setCaptureMethod('type')}>
						<span aria-hidden="true">⌨</span><span><b>Use keyboard dictation</b><small>Open Gboard, then tap its microphone.</small></span><i aria-hidden="true">→</i>
					</button>
				{/if}
			</div>
		{/if}
		<div class="repeat-captures" aria-label="Repeat a common capture">
			<div><span>Capture again</span><small>Start with something familiar</small></div>
			<div>{#each repeatCaptures as item}<button type="button" onclick={() => startRepeatCapture(item.prompt)}><span aria-hidden="true">{item.symbol}</span>{item.label}</button>{/each}</div>
		</div>
			</section>
		</div>
		{/if}

		<section class="timeline-section">
			{#if activeTab === 'today' && backupDue}<button class="backup-nudge" type="button" onclick={openDataTools}><span>↓</span><div><b>Protect your traces</b><small>Your history currently lives only on this device. Create a fresh backup.</small></div><i>→</i></button>{/if}
			{#if activeTab === 'today'}
				{#if loadingEntries}
					<div class="timeline-empty spine-loading"><span class="spinner dark"></span><p>Opening your traces…</p></div>
				{:else}
					<div class="trace-spine">
						<section class="spine-section today-spine">
							<header><span>Today</span><small>{todaySpineEntries.length} {todaySpineEntries.length === 1 ? 'trace' : 'traces'}</small></header>
							{#if todaySpineEntries.length}{#each todaySpineEntries as entry (entry.id)}{@render spineTrace(entry, 'today')}{/each}{:else}<button class="spine-empty" type="button" onclick={() => openCapture()}><span>＋</span><div><b>Nothing captured today</b><small>Capture the first thing worth remembering.</small></div></button>{/if}
						</section>

						{#if overdueAttentionEntries.length}
							<section class="spine-section attention-spine">
								<header><span>Needs attention</span><small>{overdueAttentionEntries.length} overdue</small></header>
								{#each overdueAttentionEntries as entry (entry.id)}{@render spineTrace(entry, 'attention')}{/each}
							</section>
						{/if}

						<section class="spine-section ahead-spine">
							<header><span>Ahead</span>{#if actionableEntries.length}<button type="button" onclick={showUpcoming}>View plans {actionableEntries.length} →</button>{/if}</header>
							{#if aheadEntries.length}{#each aheadEntries.slice(0, showAllAhead ? aheadEntries.length : 4) as entry (entry.id)}{@render spineTrace(entry, 'ahead')}{/each}{#if aheadEntries.length > 4 && !showAllAhead}<button class="spine-more" type="button" onclick={() => (showAllAhead = true)}>Show {aheadEntries.length - 4} more future {aheadEntries.length - 4 === 1 ? 'trace' : 'traces'} →</button>{/if}{:else}<button class="spine-empty" type="button" onclick={() => openCapture('type')}><span>→</span><div><b>Nothing planned ahead</b><small>Future events and reminders will appear here.</small></div></button>{/if}
						</section>

						{#if pastEntries.length}
							<button class="behind-section past-link" type="button" onclick={showTimeline}><span>Past traces</span><small>{pastEntries.length} {pastEntries.length === 1 ? 'trace' : 'traces'} · back to {formatSpineDate(pastEntries[pastEntries.length - 1])}</small><i aria-hidden="true">→</i></button>
						{/if}
					</div>
				{/if}
			{:else if activeTab === 'timeline'}
				<div class="section-heading"><div><p class="eyebrow">Archive</p><h2>Your full timeline</h2></div><span class="entry-count">{filteredTimeline.length}</span></div>
				<div class="timeline-tools">
					<label class="timeline-search"><span aria-hidden="true">⌕</span><input type="search" bind:value={timelineQuery} placeholder="Search people, places, notes…" aria-label="Search your timeline" />{#if timelineQuery}<button type="button" onclick={() => (timelineQuery = '')} aria-label="Clear timeline search">×</button>{/if}</label>
					<div class="timeline-filters" role="group" aria-label="Filter timeline by category"><button class:active={timelineFilter === 'All'} aria-pressed={timelineFilter === 'All'} type="button" onclick={() => (timelineFilter = 'All')}>All</button>{#each availableTimelineCategories as category}<button class:active={timelineFilter === category} aria-pressed={timelineFilter === category} type="button" onclick={() => (timelineFilter = category)}><i class={`category-dot ${category.toLowerCase()}`}></i>{category}</button>{/each}</div>
				</div>
				<div class="timeline-groups">
					{#if loadingEntries}<div class="timeline-empty"><span class="spinner dark"></span><p>Opening your timeline…</p></div>{:else if timeline.length === 0}<div class="timeline-empty"><span>＋</span><strong>Your timeline is ready</strong><p>Your first confirmed capture will appear here.</p></div>{:else if filteredTimeline.length === 0}<div class="timeline-empty"><span>⌕</span><strong>No matching traces</strong><p>Try another word or choose a different category.</p><button type="button" onclick={() => { timelineQuery = ''; timelineFilter = 'All'; }}>Clear filters</button></div>{:else}{#each timelineGroups as group (group.key)}<section class="timeline-day-group"><header><h3>{group.label}</h3><span>{group.entries.length}</span></header><div class="timeline-list">{#each group.entries as entry (entry.id)}{@render traceCard(entry)}{/each}</div></section>{/each}{/if}
				</div>
			{/if}
		</section>

		{#if activeTab === 'upcoming'}
			<section class="upcoming-screen" aria-labelledby="upcoming-title">
				<header class="upcoming-header">
					<div><p class="eyebrow">Things to act on</p><h1 id="upcoming-title">Plans</h1></div>
					<span>{actionableEntries.length}</span>
				</header>

				{#if loadingEntries}
					<div class="upcoming-empty"><span class="spinner dark"></span><p>Opening your plans…</p></div>
				{:else if actionableEntries.length === 0}
					<div class="upcoming-empty"><span>✓</span><h2>Nothing needs your attention</h2><p>Upcoming events and open reminders will appear here after you confirm them.</p><button type="button" onclick={() => openCapture()}>Capture something</button></div>
				{:else}
					<div class="upcoming-groups">
						{#each upcomingGroups as group (group.key)}
							<section class:overdue={group.key === 'overdue'} class="upcoming-group">
								<div class="upcoming-group-heading"><h2>{group.label}</h2><span>{group.entries.length}</span></div>
								<div class="upcoming-list">
									{#each group.entries as entry (entry.id)}
										<article class={`upcoming-item ${entry.destination.toLowerCase()}`}>
											<div class="upcoming-item-top"><span class="upcoming-symbol" aria-hidden="true">{entry.destination === 'Calendar' ? '▦' : '!'}</span><div><div class="upcoming-meta"><span>{entry.destination}</span>{#if entry.category !== entry.destination}<i>·</i><span>{entry.category}</span>{/if}</div><h3>{entry.title}</h3></div></div>
											<p class="upcoming-detail">“{entry.transcript}”</p>
											<div class="upcoming-facts">
												<span><i>◷</i>{entry.scheduledDate ? formatScheduledDate(entry.scheduledDate) : 'Date needed'}{entry.scheduledTime ? ` at ${formatClockTime(entry.scheduledTime)}` : ' · All day'}</span>
												{#if entry.destination === 'Calendar' && entry.durationMinutes}<span><i>↔</i>{entry.durationMinutes} minutes</span>{/if}
												{#if entry.people?.length}<span><i>☺</i>{entry.people.join(' & ')}</span>{/if}
											</div>
											<div class="upcoming-actions">
												<button type="button" onclick={() => beginEntryEdit(entry)}>{entry.scheduledDate ? 'Reschedule or edit' : 'Add a date'}</button>
												{#if entry.destination === 'Reminder'}<button class="complete" type="button" onclick={() => completeReminder(entry)}>Mark done</button>{/if}
											</div>
										</article>
									{/each}
								</div>
							</section>
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		{#if activeTab === 'insights'}
			<section class="insights-screen" aria-labelledby="insights-title">
				<header class="insights-header">
					<div><p class="eyebrow">Patterns over time</p><h1 id="insights-title">Insights</h1></div>
					<span aria-label={`${insights.entries.length} traces in this period`}>{insights.entries.length}</span>
				</header>

				<div class="range-picker" role="group" aria-label="Insight period">
					<button class:active={insightRange === 7} aria-pressed={insightRange === 7} type="button" onclick={() => (insightRange = 7)}>7 days</button>
					<button class:active={insightRange === 30} aria-pressed={insightRange === 30} type="button" onclick={() => (insightRange = 30)}>30 days</button>
					<button class:active={insightRange === 'all'} aria-pressed={insightRange === 'all'} type="button" onclick={() => (insightRange = 'all')}>All time</button>
				</div>

				{#if loadingEntries}
					<div class="insights-empty"><span class="spinner dark"></span><p>Reading your timeline…</p></div>
				{:else if timeline.length === 0}
					<div class="insights-empty"><span>⌁</span><h2>Insights start with a trace</h2><p>Capture a few moments and patterns will begin to appear here.</p><button type="button" onclick={() => openCapture()}>Capture something</button></div>
				{:else if insights.entries.length === 0}
					<div class="insights-empty"><span>○</span><h2>No traces in this period</h2><p>Choose a longer range to see your earlier captures.</p></div>
				{:else}
					<section class="weekly-story-card" aria-label={`Summary, ${insightRangeLabel.toLocaleLowerCase()}`}>
						<div>{#each insights.stories as story}<p>{story}</p>{/each}</div>
					</section>

					<section class="signals-section" aria-label="Signals">
						<div class="signal-grid">
							<article class="signal-wellbeing"><p>Wellbeing</p><strong>{insights.averageWellbeing === null ? '—' : `${insights.averageWellbeing.toFixed(1)} / 10`}</strong><small>{insights.wellbeingCount} scored {insights.wellbeingCount === 1 ? 'check-in' : 'check-ins'}</small></article>
							<article class="signal-habit"><p>Activity</p><strong>{insights.activityMinutes ? `${insights.activityMinutes} min` : insights.activityCount}</strong><small>{insights.activityCount} {insights.activityCount === 1 ? 'session' : 'sessions'} done</small></article>
							<article class="signal-reminder"><p>Reminders</p><strong>{insights.remindersDone} / {insights.reminderCount}</strong><small>done</small></article>
						</div>
					</section>

					<section class="activity-card">
						<div class="insight-heading"><div><p class="eyebrow">Rhythm</p><h2>Traces per {insightRange === 'all' ? 'week' : 'day'}</h2></div><span>{insightRangeLabel}</span></div>
						<div class="activity-chart" style:--bars={insights.bars.length} role="img" aria-label={`Traces per ${insightRange === 'all' ? 'week' : 'day'}, ${insightRangeLabel.toLocaleLowerCase()}`}>
							{#each insights.bars as bar (bar.key)}
								<div class:current={bar.current}><span>{insights.bars.length <= 7 && bar.count ? bar.count : ''}</span><i style:height={`${bar.count ? Math.max(6, (bar.count / maxInsightBar) * 82) : 3}px`}></i><small>{bar.label}</small></div>
							{/each}
						</div>
					</section>

					<section class="category-card">
						<div class="insight-heading"><div><p class="eyebrow">Composition</p><h2>Your traces</h2></div><span>{insightRangeLabel}</span></div>
						<div class="category-bars">
							{#each insights.categoryCounts.filter((item) => item.count > 0) as item}
								<div><div><span><i class={`category-dot ${item.category.toLowerCase()}`}></i>{item.category}</span><b>{item.count} · {item.percentage}%</b></div><progress value={item.count} max={insights.entries.length}>{item.percentage}%</progress></div>
							{/each}
						</div>
					</section>
				{/if}
			</section>
		{/if}

		{#if !captureOpen && !draft && !editingEntry && !showDataTools}<button class="floating-capture" type="button" onclick={() => openCapture()}><span aria-hidden="true"><i></i></span><b>Capture</b></button>{/if}
		{#if notice}<div class="toast" role="status"><span>✓</span><b>{notice}</b>{#if noticeAction === 'undo'}<button type="button" onclick={undoDelete}>Undo</button>{:else if noticeAction === 'capture'}<button type="button" onclick={beginAnotherCapture}>Capture another</button>{/if}</div>{/if}

		{#if showDataTools}
			<div class="sheet-backdrop" role="presentation">
				<div class="data-tools-sheet" role="dialog" aria-modal="true" aria-labelledby="data-tools-title">
					<div class="sheet-handle"></div>
					<div class="sheet-heading"><div><span class="data-tools-symbol">↧</span><div><p>Device-local storage</p><h2 id="data-tools-title">Your Trace data</h2></div></div><button type="button" onclick={() => (showDataTools = false)} aria-label="Close data tools">×</button></div>
					<div class="data-summary"><article><span>Entries</span><strong>{timeline.length}</strong></article><article><span>Storage</span><strong>This device</strong>{#if storagePersisted !== null}<small>{storagePersisted ? 'Protected from automatic clean-up' : 'Chrome may clear it if space runs low'}</small>{/if}</article></div>
					<div class="backup-status"><span class:ready={Boolean(lastBackupAt)}>{lastBackupAt ? '✓' : '!'}</span><div><b>{formatLastBackup()}</b><small>A backup protects your timeline if Chrome’s site data is cleared.</small></div></div>
					<div class="data-actions">
						<button type="button" onclick={exportBackup}><span>↓</span><div><b>Export backup</b><small>Download every entry as a Trace JSON file</small></div></button>
						<label class:disabled={restoringBackup}><span>↑</span><div><b>{restoringBackup ? 'Restoring…' : 'Restore backup'}</b><small>Merge a previous Trace backup into this device</small></div><input type="file" accept="application/json,.json" disabled={restoringBackup} onchange={restoreBackup} /></label>
					</div>
					<p class="merge-note"><span>i</span>Restore never deletes current entries. Matching IDs are updated and everything else is merged.</p>
					{#if backupMessage}<p class="data-message success" role="status"><span>✓</span>{backupMessage}</p>{/if}
					{#if backupError}<p class="data-message error" role="alert"><span>!</span>{backupError}</p>{/if}
					<button class="data-done" type="button" onclick={() => (showDataTools = false)}>Done</button>
				</div>
			</div>
		{/if}

		{#if editingEntry}
			<div class="sheet-backdrop" role="presentation">
				<div class="edit-entry-sheet" role="dialog" aria-modal="true" aria-labelledby="edit-entry-title">
					<div class="sheet-handle"></div>
					<div class="sheet-heading"><div><span class={`edit-category-symbol ${editingEntry.category.toLowerCase()}`}>✎</span><div><p>Timeline entry</p><h2 id="edit-entry-title">Edit your trace</h2></div></div><button type="button" onclick={closeEntryEditor} aria-label="Close entry editor">×</button></div>
					<form class="entry-edit-form" onsubmit={saveEditedEntry} novalidate>
						<section class="capture-rewrite">
							<label for="edit-capture">Replace the full capture</label>
							<textarea id="edit-capture" rows="3" bind:value={editingEntry.transcript} placeholder="Rewrite what happened or what you are planning"></textarea>
							<div><small>Reinterpret replaces the category, wording, date, and destination below.</small><button type="button" onclick={reinterpretEditedCapture} disabled={!editingEntry.transcript.trim()}>Reinterpret capture</button></div>
							{#if editInterpretationMessage}<p role="status"><span>✓</span>{editInterpretationMessage}</p>{/if}
						</section>
						<div class="entry-edit-grid">
							<label>Category<select bind:value={editingEntry.category}>{#each insightCategories as category}<option value={category}>{category}</option>{/each}</select></label>
							<label>Title<input bind:value={editingEntry.title} required /></label>
							<label class="wide">Details<input bind:value={editingEntry.detail} required /></label>
							{#if editingEntry.category === 'Wellbeing'}
								<label>Score<select bind:value={editingScore}><option value="">No score</option>{#each wellbeingScores as score}<option value={String(score)}>{score} / 10</option>{/each}</select></label>
							{/if}
							{#if editingEntry.category === 'Place'}
								<label class="wide">Address or area<input bind:value={editingEntry.placeAddress} placeholder="Optional, e.g. Vesterbro, Copenhagen" /></label>
							{/if}
							<label>Destination<select bind:value={editingEntry.destination}>{#each destinations as destination}<option value={destination}>{destination}</option>{/each}</select></label>
							<label>{editingEntry.destination === 'Timeline' ? 'Date' : 'Scheduled date'}<input type="date" bind:value={editingEntry.scheduledDate} required={editingEntry.destination !== 'Timeline'} /></label>
							<label>Time<input type="time" bind:value={editingEntry.scheduledTime} /></label>
							{#if editingEntry.destination === 'Calendar'}
								<label>Duration<select bind:value={editingEntry.durationMinutes}><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={90}>1½ hours</option><option value={120}>2 hours</option><option value={180}>3 hours</option></select></label>
							{/if}
							{#if editingEntry.category === 'Social'}
								<label class="wide">People<input bind:value={editingPeople} placeholder="Michael, Jennifer" /></label>
							{/if}
							{#if editingEntry.category === 'Social' || editingEntry.destination !== 'Timeline'}
								<label class="wide">Status<select bind:value={editingEntry.status}><option value="Planned">Planned</option><option value="Tentative">Tentative</option><option value="Completed">Completed</option></select></label>
							{/if}
						</div>
						{#if editingEntry.destination === 'Timeline'}<p class="field-hint">Leave the date empty to keep the day it was captured.</p>{/if}
						{#if editingEntry.category === 'Place'}
							<section class:attached={editingEntry.latitude !== undefined && editingEntry.longitude !== undefined} class="edit-place-location">
								<div><span>⌖</span><div><b>{editingEntry.latitude !== undefined && editingEntry.longitude !== undefined ? 'Location attached' : 'No precise location attached'}</b><small>{editingEntry.latitude !== undefined && editingEntry.longitude !== undefined ? `${editingEntry.latitude}, ${editingEntry.longitude}${editingEntry.locationAccuracy ? ` · about ${editingEntry.locationAccuracy} m` : ''}` : 'Attach where you are now, or rely on the name and address.'}</small></div></div>
								<div class="edit-place-actions"><button type="button" disabled={placeLocationState === 'requesting'} onclick={() => attachCurrentLocation('edit')}>{placeLocationState === 'requesting' ? 'Locating…' : editingEntry.latitude !== undefined ? 'Update location' : 'Attach current location'}</button>{#if editingEntry.latitude !== undefined}<button class="remove" type="button" onclick={() => removePlaceLocation('edit')}>Remove</button>{/if}</div>
								{#if placeLocationMessage}<p class:error={placeLocationState === 'error'}>{placeLocationMessage}</p>{/if}
							</section>
						{/if}
						{#if editingEntry.destination !== 'Timeline'}<p class="edit-route-note"><span>○</span>Saved only in Trace. Google connection is not enabled yet.</p>{/if}
						<p class="edit-captured-at">Originally captured {formatDateTime24(editingEntry.capturedAt)}</p>
						{#if editError}<p class="draft-save-error" role="alert"><span>!</span>{editError}</p>{/if}
						<div class="sheet-actions"><button type="button" onclick={closeEntryEditor}>Cancel</button><button class="confirm" type="submit">Save changes</button></div>
					</form>
				</div>
			</div>
		{/if}

		{#if draft}
			<div class="sheet-backdrop" role="presentation">
				<div class="confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
					<div class="sheet-handle"></div>
					<div class="sheet-heading"><div><span class="success-ring">✓</span><div><p>Here’s what I heard</p><h2 id="confirm-title">{draft.scheduledDates && draft.scheduledDates.length > 1 ? `Confirm ${draft.scheduledDates.length} entries` : 'Confirm your entry'}</h2></div></div><button type="button" onclick={dismissDraft} aria-label="Back to capture">×</button></div>
					<blockquote>“{draft.transcript}”</blockquote>
					<div class="interpreted-card">
						<div class="category-line"><span class={`category-dot ${draft.category.toLowerCase()}`}></span><select bind:value={draft.category} onchange={markDraftCategorySelected} aria-label="Entry category">{#each insightCategories as category}<option value={category}>{category}</option>{/each}</select>{#if draft.destination !== 'Timeline'}<span class={`route-badge ${draft.destination.toLowerCase()}`}>{draft.destination}</span>{/if}{#if draft.status}<span class="status-label">{draft.status}</span>{/if}</div>
						{#if showDraftDetails && draft.classificationReason}<p class="classification-reason"><span>⌁</span>{draft.classificationReason} · {draft.classificationConfidence || 'Low'} confidence</p>{/if}
						{#if editing}
							<div class="edit-fields"><label>Title<input bind:value={draft.title} /></label><label>Detail<input bind:value={draft.detail} /></label></div>
						{:else}
							<div class="entry-summary">
								<strong>{draft.title}</strong>
								<div class="event-facts">
									<div><span>When</span><b>{draftWhen}{#if draft.scheduledTimeAssumed && !draft.scheduledTimeAlternative}<em class="guess-tag">approx.</em>{/if}</b>{#if draft.scheduledTimeAssumed && draft.scheduledTimeAlternative}<button class="time-swap" type="button" onclick={useAlternativeTime} aria-label={`Change the time to ${draft.scheduledTimeAlternative}`}>or {draft.scheduledTimeAlternative}?</button>{/if}</div>
									{#if draft.category === 'Social'}<div><span>People</span><b>{draft.people?.join(' & ') || 'Not specified'}</b></div>{/if}
									{#if draft.category !== 'Social' && draft.category !== 'Wellbeing' && !fillerDetails.has(draft.detail)}<div><span>Detail</span><b>{draft.detail}</b></div>{/if}
								</div>
								{#if draft.category === 'Wellbeing'}
									<div class="score-picker" role="group" aria-label="Score from 0 to 10, optional"><p><b>Score</b><small>{draft.wellbeingScore === undefined ? 'Optional · tap to add' : 'Tap again to clear'}</small></p><div>{#each wellbeingScores as score}<button type="button" class:selected={draft.wellbeingScore === score} aria-pressed={draft.wellbeingScore === score} onclick={() => setDraftScore(score)}>{score}</button>{/each}</div></div>
								{/if}
							</div>
						{/if}
					</div>

					{#if draft.scheduledDates && draft.scheduledDates.length > 1}
						<section class="multi-date-card" aria-label="Inferred dates">
							<div class="multi-date-heading"><span>▦</span><div><p>Multiple dates understood</p><h3>{draft.scheduledDates.length} dates</h3><small>Each date becomes its own trace that you can edit on its own.</small></div></div>
							<div class="multi-date-list">
								{#each draft.scheduledDates as date, index (`${date}-${index}`)}
									<div><span>{index + 1}</span><label><small>{formatScheduledDate(date)}</small><input type="date" value={date} onchange={(event) => updateDraftOccurrence(index, event.currentTarget.value)} /></label><button type="button" onclick={() => removeDraftOccurrence(index)} aria-label={`Remove ${formatScheduledDate(date)}`}>×</button></div>
								{/each}
							</div>
						</section>
					{/if}

					{#if draftClarification}
						<section class="clarification-card" aria-live="polite">
							<div class="clarification-heading"><span>?</span><div><p>One quick detail</p><h3>{draftClarification.question}</h3><small>{draftClarification.help}</small></div></div>
							{#if draftClarification.kind === 'date'}
								<div class="clarification-options date-options"><button type="button" onclick={() => setDraftRelativeDate(0, 'Today')}>Today</button><button type="button" onclick={() => setDraftRelativeDate(1, 'Tomorrow')}>Tomorrow</button><button type="button" onclick={() => setDraftRelativeDate(7, 'In one week')}>In one week</button><label>Choose<input type="date" bind:value={draft.scheduledDate} onchange={() => (draftSaveError = '')} /></label></div>
							{:else}
								<div class="clarification-options time-options"><button type="button" onclick={() => setDraftTime('')}>All day</button><button type="button" onclick={() => setDraftTime('09:00')}>Morning</button><button type="button" onclick={() => setDraftTime('14:00')}>Afternoon</button><button type="button" onclick={() => setDraftTime('19:00')}>Evening</button></div>
							{/if}
						</section>
					{/if}

					<button class="confirmation-detail-toggle" type="button" aria-expanded={showDraftDetails} onclick={() => (showDraftDetails = !showDraftDetails)}><span>{showDraftDetails ? '−' : '+'}</span><div><b>{showDraftDetails ? 'Hide details' : draft.category === 'Place' ? 'Add location, date or destination' : 'Change date, time or destination'}</b><small>{draft.destination} · {draftWhen}</small></div><i aria-hidden="true">{showDraftDetails ? '⌃' : '⌄'}</i></button>

					{#if showDraftDetails && draft.category === 'Place'}
						<section class:attached={draft.latitude !== undefined && draft.longitude !== undefined} class="place-handoff-card">
							<div class="place-handoff-heading"><span>⌖</span><div><p>Maps handoff</p><h3>Remember where you found it</h3><small>Location is attached only when you choose it.</small></div></div>
							<label>Address or area <small>optional</small><input bind:value={draft.placeAddress} placeholder="e.g. Vesterbro, Copenhagen" /></label>
							<div class="place-location-status">
								<div><b>{draft.latitude !== undefined && draft.longitude !== undefined ? 'Current position attached' : 'No precise position yet'}</b><small>{draft.latitude !== undefined && draft.longitude !== undefined ? `${draft.latitude}, ${draft.longitude}${draft.locationAccuracy ? ` · about ${draft.locationAccuracy} m accuracy` : ''}` : 'Trace can save your phone’s current coordinates with this place.'}</small></div>
								<button type="button" disabled={placeLocationState === 'requesting'} onclick={() => attachCurrentLocation('draft')}>{placeLocationState === 'requesting' ? 'Locating…' : draft.latitude !== undefined ? 'Update' : 'Attach location'}</button>
							</div>
							{#if placeLocationMessage}<p class:error={placeLocationState === 'error'} class="place-location-message"><span>{placeLocationState === 'error' ? '!' : '✓'}</span>{placeLocationMessage}{#if draft.latitude !== undefined}<button type="button" onclick={() => removePlaceLocation('draft')}>Remove</button>{/if}</p>{/if}
							<div class="maps-preview-actions"><a href={mapsSearchUrl(draft)} target="_blank" rel="noreferrer"><span>↗</span>Preview Maps search</a>{#if draft.latitude !== undefined && draft.longitude !== undefined}<a href={mapsPinUrl(draft)} target="_blank" rel="noreferrer"><span>⌖</span>Preview captured pin</a>{/if}</div>
						</section>
					{/if}

					{#if showDraftDetails}<div class="routing-card">
						<div class="routing-heading"><div><b>Where should this go?</b><small>Trace inferred an action separately from its category.</small></div><span class={`route-confidence ${(draft.destinationConfidence || 'low').toLowerCase().replace(' ', '-')}`}>{draft.destinationConfidence === 'User selected' ? 'Your choice' : `${draft.destinationConfidence || 'Low'} confidence`}</span></div>
						<div class="destination-picker" role="group" aria-label="Entry destination">
							<button class:selected={draft.destination === 'Timeline'} type="button" aria-pressed={draft.destination === 'Timeline'} onclick={() => setDraftDestination('Timeline')}><span>≋</span><b>Timeline</b><small>Keep in Trace</small></button>
							<button class:selected={draft.destination === 'Calendar'} type="button" aria-pressed={draft.destination === 'Calendar'} onclick={() => setDraftDestination('Calendar')}><span>▦</span><b>Calendar</b><small>Plan an event</small></button>
							<button class:selected={draft.destination === 'Reminder'} type="button" aria-pressed={draft.destination === 'Reminder'} onclick={() => setDraftDestination('Reminder')}><span>!</span><b>Reminder</b><small>Prompt me later</small></button>
						</div>
						{#if draft.destinationReason}<p class="routing-reason"><span>⌁</span>{draft.destinationReason}</p>{/if}

						<div class="schedule-fields">
							{#if draft.scheduledDates && draft.scheduledDates.length > 1}<div class="multi-date-field"><small>Dates</small><b>{draft.scheduledDates.length} listed above</b></div>{:else}<label>Date <small>{draft.destination === 'Timeline' ? 'empty = today' : 'required'}</small><input type="date" bind:value={draft.scheduledDate} required={draft.destination !== 'Timeline'} onchange={() => (draftSaveError = '')} /></label>{/if}
							<label>Time <small>{draft.destination === 'Calendar' ? 'empty = all day' : 'optional'}</small><input type="time" bind:value={draft.scheduledTime} onchange={(event) => setDraftTime(event.currentTarget.value)} /></label>
							{#if draft.destination === 'Calendar'}
								<label>Duration<select bind:value={draft.durationMinutes}><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={90}>1½ hours</option><option value={120}>2 hours</option><option value={180}>3 hours</option></select></label>
							{/if}
						</div>
						{#if draft.destination !== 'Timeline'}<div class="google-route-note"><span>○</span><div><b>Saved in Trace only</b><small>Nothing will be sent to Google until you choose to connect it later.</small></div></div>{/if}
					</div>
					{/if}
					{#if draftSaveError}<p class="draft-save-error" role="alert"><span>!</span>{draftSaveError}</p>{/if}
					<div class="sheet-actions confirmation-actions"><button type="button" disabled={savingDraft} onclick={() => (editing = !editing)}>{editing ? 'Done editing' : 'Edit'}</button><button class="confirm" type="button" disabled={savingDraft} onclick={confirmDraft}>{savingDraft ? 'Saving…' : draft.scheduledDates && draft.scheduledDates.length > 1 ? `Confirm ${draft.scheduledDates.length}` : 'Looks right'}</button></div>
				</div>
			</div>
		{/if}
	</section>
</main>
