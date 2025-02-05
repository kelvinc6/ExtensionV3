import { Ref, nextTick, reactive, toRef, watchEffect } from "vue";
import { useTimeoutFn } from "@vueuse/core";
import { useConfig } from "@/composable/useSettings";
import { useChatMessages } from "./useChatMessages";
import UiScrollableVue from "@/ui/UiScrollable.vue";

const scrollDuration = useConfig<number>("chat.smooth_scroll_duration");
const lineLimit = useConfig<number>("chat.line_limit");

const data = reactive({
	// Scroll Data
	userInput: 0,
	lineLimit: lineLimit,
	init: false,
	sys: true,
	live: false,
	visible: true,
	paused: false, // whether or not scrolling is paused
	duration: scrollDuration,

	scrollClear: () => {
		return;
	},

	container: undefined as HTMLElement | undefined,
	bounds: undefined as DOMRect | undefined,
});

interface ChatScrollerInit {
	scroller: Ref<InstanceType<typeof UiScrollableVue> | undefined>;
	bounds: Ref<DOMRect>;
}

export function useChatScroller(initWith?: ChatScrollerInit) {
	const container = toRef(data, "container");
	const bounds = toRef(data, "bounds");

	const messages = useChatMessages();

	if (initWith) {
		watchEffect(() => {
			if (initWith.scroller.value?.container) {
				container.value = initWith.scroller.value.container;
			}

			if (initWith.bounds.value) {
				bounds.value = initWith.bounds.value;
			}

			if (initWith.scroller.value?.isActive) {
				data.userInput++;
			}
		});
	}

	/**
	 * Scrolls the chat to the bottom
	 */
	async function scrollToLive(duration = 0): Promise<void> {
		if (!container.value || !bounds?.value || data.paused) return;

		data.scrollClear();

		data.sys = true;
		if (duration === 0) {
			container.value.scrollTo({ top: container.value.scrollHeight });

			bounds.value = container.value.getBoundingClientRect();
			return;
		}

		const from = await new Promise<number>((resolve) => {
			nextTick(() => {
				if (!container.value) return 0;

				resolve(container.value.scrollTop);
			});
		});

		const start = Date.now();

		let shouldClear = false;

		function scroll() {
			if (!container.value || !bounds?.value || data.paused || shouldClear) return;

			const currentTime = Date.now();
			const time = Math.min(1, (currentTime - start) / duration);
			container.value.scrollTop = time * (container.value.scrollHeight - from) + from;

			if (time < 1) requestAnimationFrame(scroll);
			else bounds.value = container.value.getBoundingClientRect();
		}

		data.scrollClear = () => (shouldClear = true);

		if (duration < 1) {
			container.value.scrollTo({ top: container.value.scrollHeight });
			bounds.value = container.value.getBoundingClientRect();
		} else requestAnimationFrame(scroll);
	}

	/**
	 * Pauses the scrolling of the chat
	 */
	function pause(): void {
		data.paused = true;
	}

	/**
	 * Unpauses the scrolling of the chat
	 */
	async function unpause(): Promise<void> {
		data.paused = false;
		data.init = true;

		// Lazily move the messages in the pause buffer to the main buffer
		let n = 0;
		while (messages.pauseBuffer.length) {
			const unbuf = messages.pauseBuffer.splice(0, 5);
			n += 50;

			useTimeoutFn(() => {
				for (const msg of unbuf) messages.add(msg, true);
				nextTick(() => {
					scrollToLive();
				});
			}, n);
		}

		nextTick(() => {
			data.init = false;
		});
	}

	async function onScroll() {
		const { top, h } = await new Promise<{ top: number; h: number }>((resolve) => {
			nextTick(() => {
				if (!container.value || !bounds?.value) return { top: 0, h: 0 };

				const top = Math.floor(container.value.scrollTop);
				const h = Math.floor(container.value.scrollHeight - bounds.value.height);

				resolve({ top, h });
			});
		});

		// Whether or not the scrollbar is at the bottom
		const live = (data.live = top >= h - 1);

		if (data.init) {
			return;
		}
		if (data.sys) {
			data.sys = false;
			return;
		}

		if (data.userInput > 0) {
			data.userInput = 0;
			pause();
		}

		// Check if the user has scrolled back down to live mode
		if (live) {
			unpause();
		}
	}

	function onWheel(e: WheelEvent) {
		if (e.deltaY < 0) data.userInput++;
	}

	return reactive({
		init: toRef(data, "init"),
		paused: toRef(data, "paused"),
		lineLimit: toRef(data, "lineLimit"),
		duration: toRef(data, "duration"),
		live: toRef(data, "live"),

		scrollToLive,
		pause,
		unpause,
		onScroll,
		onWheel,
	});
}
