<script lang="ts">
	import './app.css';
	import './redesign.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Trace — Your personal timeline</title>
	<meta name="description" content="A voice-first personal timeline for wellbeing, reminders, habits, and everyday events." />
</svelte:head>

{@render children()}
