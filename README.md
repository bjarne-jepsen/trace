# Trace

Trace is a mobile-first personal capture PWA for quickly recording what you do, feel, discover, and need to remember. Natural-language input is interpreted into editable traces such as habits, wellbeing observations, reminders, social plans, and general notes.

The app is designed primarily for installation in Chrome on Android and supports both speech and typed capture.

## Technology

- Bun
- Svelte and SvelteKit
- Supabase
- Static PWA deployment

## Local development

Install the dependencies:

```sh
bun install
```

Copy the environment template and add the public values from your Supabase project:

```sh
cp .env.example .env
```

Start the development server:

```sh
bun run dev
```

## Checks and tests

```sh
bun run check
bun test
```

## Production build

```sh
bun run build
```

The static production site is written to `build/`.

## Supabase

The initial database schema is available in `supabase/migrations/`. Authentication and external Google synchronization are intentionally not part of the current prototype.
