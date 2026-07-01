<script lang="ts">
	import { cubicInOut } from 'svelte/easing';
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	type AppleMusicMode = 'button' | 'link' | 'none';
	type ArtworkSize = 'md' | 'lg';

	let {
		title,
		artist,
		meta,
		artworkUrl = null,
		artworkAlt,
		fallbackLabel = 'LIVE',
		fallbackAriaLabel,
		appleMusicMode = 'none',
		appleMusicHref = null,
		appleMusicLoading = false,
		appleMusicUnavailableLabel = '',
		appleMusicTitle = 'Open in Apple Music',
		appleMusicAriaLabel = 'Open in Apple Music',
		onAppleMusicClick,
		badgeLabel = '',
		titleFirst = false,
		sidePrimary = '',
		sidePrimaryDatetime = '',
		sideSecondary = '',
		pressable = '',
		artworkSize = 'lg',
		rowClass = 'flex items-center gap-4'
	}: {
		title: string;
		artist: string;
		meta: string;
		artworkUrl?: string | null;
		artworkAlt: string;
		fallbackLabel?: string;
		fallbackAriaLabel?: string;
		appleMusicMode?: AppleMusicMode;
		appleMusicHref?: string | null;
		appleMusicLoading?: boolean;
		appleMusicUnavailableLabel?: string;
		appleMusicTitle?: string;
		appleMusicAriaLabel?: string;
		onAppleMusicClick?: () => void;
		badgeLabel?: string;
		titleFirst?: boolean;
		sidePrimary?: string;
		sidePrimaryDatetime?: string;
		sideSecondary?: string;
		pressable?: string;
		artworkSize?: ArtworkSize;
		rowClass?: string;
	} = $props();

	const artworkClass = $derived(
		artworkSize === 'lg'
			? 'size-14 shrink-0 rounded-lg object-cover'
			: 'size-12 shrink-0 rounded-lg object-cover'
	);
	const fallbackClass = $derived(
		artworkSize === 'lg'
			? 'flex size-14 shrink-0 items-center justify-center rounded-lg bg-ink text-xs font-black tracking-widest text-surface'
			: 'flex size-12 shrink-0 items-center justify-center rounded-lg bg-ink text-xs font-black tracking-widest text-surface'
	);
	const artworkPixels = $derived(artworkSize === 'lg' ? 56 : 48);
	const appleMusicPulse = new Tween(1, {
		duration: () => (prefersReducedMotion.current ? 0 : 600),
		easing: cubicInOut
	});

	$effect(() => {
		if (appleMusicMode !== 'button' || !appleMusicLoading || prefersReducedMotion.current) {
			void appleMusicPulse.set(1, { duration: 0 });
			return;
		}

		let cancelled = false;

		async function pulse() {
			while (!cancelled) {
				await appleMusicPulse.set(0.45, {
					duration: prefersReducedMotion.current ? 0 : 600,
					easing: cubicInOut
				});
				if (cancelled) return;
				await appleMusicPulse.set(1, {
					duration: prefersReducedMotion.current ? 0 : 600,
					easing: cubicInOut
				});
			}
		}

		void pulse();

		return () => {
			cancelled = true;
		};
	});
</script>

{#snippet appleMusicIcon(className: string, opacity = 1)}
	<svg viewBox="0 0 24 24" class={className} fill="currentColor" aria-hidden="true" style:opacity={opacity}>
		<path
			d="M23.994 6.124a9.23 9.23 0 0 0-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 0 0-1.877-.726 10.496 10.496 0 0 0-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408-.056.392-.088.785-.1 1.18 0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03a12.5 12.5 0 0 0 1.57-.1c.822-.106 1.596-.35 2.295-.81a5.046 5.046 0 0 0 1.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.045-1.773-.6-1.943-1.536a1.88 1.88 0 0 1 1.038-2.022c.323-.16.67-.25 1.018-.324.378-.082.758-.153 1.134-.24.274-.063.457-.23.51-.516a.904.904 0 0 0 .02-.193c0-1.815 0-3.63-.002-5.443a.725.725 0 0 0-.026-.185c-.04-.15-.15-.243-.304-.234-.16.01-.318.035-.475.066-.76.15-1.52.303-2.28.456l-2.325.47-1.374.278c-.016.003-.032.01-.048.013-.277.077-.377.203-.39.49-.002.042 0 .086 0 .13-.002 2.602 0 5.204-.003 7.805 0 .42-.047.836-.215 1.227-.278.64-.77 1.04-1.434 1.233-.35.1-.71.16-1.075.172-.96.036-1.755-.6-1.92-1.544-.14-.812.23-1.685 1.154-2.075.357-.15.73-.232 1.108-.31.287-.06.575-.116.86-.177.383-.083.583-.323.6-.714v-.15c0-2.96 0-5.922.002-8.882 0-.123.013-.25.042-.37.07-.285.273-.448.546-.518.255-.066.515-.112.774-.165.733-.15 1.466-.296 2.2-.444l2.27-.46c.67-.134 1.34-.27 2.01-.403.22-.043.442-.088.663-.106.31-.025.523.17.554.482.008.073.012.148.012.223.002 1.91.002 3.822 0 5.732z"
		/>
	</svg>
{/snippet}

<div class={rowClass}>
	{#if artworkUrl}
		<img
			src={artworkUrl}
			alt={artworkAlt}
			class={artworkClass}
			width={artworkPixels}
			height={artworkPixels}
			loading="lazy"
			decoding="async"
		/>
	{:else}
		<div class={fallbackClass} role={fallbackAriaLabel ? 'img' : undefined} aria-label={fallbackAriaLabel}>
			{fallbackLabel}
		</div>
	{/if}

	<div class="relative min-w-0 flex-1 {appleMusicMode !== 'none' ? 'pr-14' : ''}">
		{#if titleFirst}
			<div class="flex min-w-0 items-center gap-2">
				<div class="truncate text-base font-bold text-ink">{title}</div>
				{#if badgeLabel}
					<span class="shrink-0 rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-bold tracking-widest text-accent uppercase">
						{badgeLabel}
					</span>
				{/if}
			</div>
			<div class="truncate text-sm text-ink-secondary">{artist}</div>
		{:else}
			<div class="truncate text-sm text-ink-secondary">{artist}</div>
			<div class="truncate text-lg font-bold text-ink">{title}</div>
		{/if}
		{#if meta}
			<div class="truncate text-sm text-ink-tertiary">{meta}</div>
		{/if}

		{#if appleMusicMode === 'button' && onAppleMusicClick}
			<button
				type="button"
				aria-label={appleMusicLoading ? 'Finding Apple Music match' : appleMusicAriaLabel}
				aria-busy={appleMusicLoading}
				title={appleMusicLoading ? 'Finding Apple Music…' : appleMusicTitle}
				class="{pressable} absolute top-1/2 right-0 flex size-10 -translate-y-1/2 items-center justify-center text-accent hover:text-ink disabled:cursor-wait disabled:opacity-70"
				onclick={onAppleMusicClick}
				disabled={appleMusicLoading}
			>
				{@render appleMusicIcon(
					'size-5 text-accent',
					prefersReducedMotion.current ? 1 : appleMusicPulse.current
				)}
			</button>
		{:else if appleMusicMode === 'link'}
			{#if appleMusicHref}
				<a
					href={appleMusicHref}
					target="_blank"
					rel="noreferrer"
					aria-label="Open in Apple Music"
					title="Open in Apple Music"
					class="{pressable} absolute top-1/2 right-0 flex size-9 -translate-y-1/2 items-center justify-center text-accent hover:text-ink"
				>
					{@render appleMusicIcon('size-4')}
				</a>
			{:else if appleMusicLoading}
				<span class="absolute top-1/2 right-0 block -translate-y-1/2 text-xs text-ink-tertiary">Finding…</span>
			{:else if appleMusicUnavailableLabel}
				<span class="absolute top-1/2 right-0 block -translate-y-1/2 text-xs text-ink-tertiary">{appleMusicUnavailableLabel}</span>
			{/if}
		{/if}
	</div>

	{#if sidePrimary || sideSecondary}
		<div class="flex shrink-0 flex-col items-end gap-1 text-right">
			{#if sidePrimary}
				<time class="text-xs tabular-nums text-ink-tertiary" datetime={sidePrimaryDatetime}>
					{sidePrimary}
				</time>
			{/if}
			{#if sideSecondary}
				<span class="max-w-32 truncate text-xs tracking-widest text-ink-tertiary uppercase">
					{sideSecondary}
				</span>
			{/if}
		</div>
	{/if}
</div>
