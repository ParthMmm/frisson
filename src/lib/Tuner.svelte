<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	// A horizontal "radio dial" tuner: a strip of tick marks you can drag
	// (or arrow-key) through to step between stations, with ticks growing
	// near the pointer for a fluid proximity effect. Adapted from
	// https://devouringdetails.com/prototypes/line-minimap, driven by
	// svelte/motion so position changes stay transform-only and interruption-safe.
	type TunerStation = { name: string; tag: string };

	let {
		stations,
		selectedName,
		onSelect
	}: {
		stations: TunerStation[];
		selectedName: string;
		onSelect: (name: string) => void;
	} = $props();

	const LINE_WIDTH = 1;
	// Minor ticks between each station "stop" — also sets the total tick
	// count, so every stop lands exactly on a tick with no rounding.
	const TICKS_PER_STOP = 6;

	const MINOR_HEIGHT = 9;
	const STOP_HEIGHT = 16;
	const PROXIMITY_INTENSITY = 14;
	const PROXIMITY_LIMIT = 28;

	const lineCount = $derived((stations.length - 1) * TICKS_PER_STOP + 1);
	const ticks = $derived(Array.from({ length: lineCount }, (_, i) => i));

	const selectedIndex = $derived(
		Math.max(
			0,
			stations.findIndex((s) => s.name === selectedName)
		)
	);

	let hoverX = $state(0);
	// The strip stretches to fill its parent (see `w-full` below) instead of
	// a fixed tick-count-derived width, so tick spacing is measured rather
	// than computed from constants. Ticks themselves are laid out by flexbox
	// `justify-between`; this mirrors that math to place the indicator and
	// find each tick's center for the proximity effect.
	let containerWidth = $state(0);
	let containerLeft = 0;
	const step = $derived(
		lineCount > 1 ? Math.max(containerWidth - LINE_WIDTH, 0) / (lineCount - 1) : 0
	);
	const indicatorX = $derived(selectedIndex * TICKS_PER_STOP * step + LINE_WIDTH / 2);
	const indicatorMotion = Tween.of(() => indicatorX, {
		duration: () => (prefersReducedMotion.current ? 0 : 300),
		easing: cubicOut
	});
	const indicatorPosition = $derived(
		prefersReducedMotion.current ? indicatorX : indicatorMotion.current
	);
	const labelOffset = $derived(
		selectedIndex === 0 ? '0%' : selectedIndex === stations.length - 1 ? '-100%' : '-50%'
	);
	const proximityFade = new Tween(0, {
		duration: () => (prefersReducedMotion.current ? 0 : 180),
		easing: cubicOut
	});

	function isStop(i: number) {
		return i % TICKS_PER_STOP === 0;
	}

	// How much extra height a tick gains based on its distance from the
	// pointer: falls off quadratically to zero at PROXIMITY_LIMIT.
	function proximityBump(distance: number) {
		if (Math.abs(distance) > PROXIMITY_LIMIT) return 0;
		const normalized = 1 - Math.abs(distance) / PROXIMITY_LIMIT;
		return PROXIMITY_INTENSITY * normalized * normalized;
	}

	// Reserved (unanimated) box height per tick — the max it could ever need.
	// The layout never changes; only `transform: scaleY()` below does, so
	// pointermove animates on the compositor instead of forcing layout on
	// up to `lineCount` elements per frame.
	function tickMaxHeight(stop: boolean) {
		return (stop ? STOP_HEIGHT : MINOR_HEIGHT) + PROXIMITY_INTENSITY;
	}

	function tickHeight(i: number) {
		const base = isStop(i) ? STOP_HEIGHT : MINOR_HEIGHT;
		const centerX = i * step + LINE_WIDTH / 2;
		return base + proximityBump(hoverX - centerX) * proximityFade.current;
	}

	function tickScale(i: number) {
		return tickHeight(i) / tickMaxHeight(isStop(i));
	}

	function updateContainerLeft(event: PointerEvent) {
		containerLeft = (event.currentTarget as HTMLElement).getBoundingClientRect().left;
	}

	function handlePointerMove(event: PointerEvent) {
		hoverX = event.clientX - containerLeft;
		if (proximityFade.target !== 1) void proximityFade.set(1, { duration: 0 });
	}

	function handlePointerLeave() {
		void proximityFade.set(0, {
			duration: prefersReducedMotion.current ? 0 : 180,
			easing: cubicOut
		});
	}

	function handleInput(event: Event) {
		const index = Number((event.currentTarget as HTMLInputElement).value);
		const station = stations[index];
		if (station) onSelect(station.name);
	}
</script>

<div class="w-full select-none">
	<div
		bind:clientWidth={containerWidth}
		class="relative w-full rounded-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-ink"
	>
		<div class="relative flex h-9 w-full items-end justify-between" aria-hidden="true">
			{#each ticks as i (i)}
				{@const stop = isStop(i)}
				{@const active = stop && i / TICKS_PER_STOP === selectedIndex}
				<span
					class="w-px shrink-0 rounded-full {active
						? 'bg-accent'
						: stop
							? 'bg-ink-tertiary'
							: 'bg-ink-tertiary/50'}"
					style="height: {tickMaxHeight(stop)}px; transform-origin: bottom; transform: scaleY({tickScale(
						i
					)});"
				></span>
			{/each}
			<div
				class="absolute bottom-0 h-9 w-0.5 rounded-full bg-accent will-change-transform"
				style="transform: translateX({indicatorPosition}px) translateX(-50%);"
			></div>
		</div>

		<input
			type="range"
			min="0"
			max={stations.length - 1}
			step="1"
			value={selectedIndex}
			oninput={handleInput}
			onpointerenter={updateContainerLeft}
			onpointerdown={updateContainerLeft}
			onpointermove={handlePointerMove}
			onpointerleave={handlePointerLeave}
			class="absolute -top-1 -bottom-1 inset-x-0 w-full cursor-pointer touch-manipulation opacity-0 outline-none"
			aria-label="Tune station"
			aria-valuetext={stations[selectedIndex]?.tag}
		/>
	</div>

	<div class="mt-2 w-full">
		<div
			class="w-max text-xs font-bold tracking-widest text-accent will-change-transform"
			style="transform: translateX({indicatorPosition}px) translateX({labelOffset});"
		>
			{stations[selectedIndex]?.tag}
		</div>
	</div>
</div>

