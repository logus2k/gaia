// llm-bridge.js


import { AgentClient } from "./agentClient.js";


export async function initLLM({ url = location.origin, agent = "topic", onStarted, onText, onDone, onError, onReconnect } = {}) {
	const client = new AgentClient({ url });
	await client.connect({ onReconnect });

	// default no-ops
	onStarted = typeof onStarted === "function" ? onStarted : () => {};
	onText    = typeof onText    === "function" ? onText    : () => {};
	onDone    = typeof onDone    === "function" ? onDone    : () => {};
	onError   = typeof onError   === "function" ? onError   : (e) => console.warn("[LLM][error]", e);

	// global stream handlers (used when send() doesn't pass per-run cbs)
	client.onStream({ onStarted, onText, onDone, onError });

	const state = {
		threadId: (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))
	};

	async function send(text) {
		if (!text || !text.trim()) return;
		return client.runText(text, { agent, threadId: state.threadId }, {
			onStarted,          // override per-send if needed
			onText,             // streams accumulated text (SDK provides full buffer) :contentReference[oaicite:3]{index=3}
			onDone,
			onError
		});
	}

	function cancel() { client.cancel(); }
	function getThreadId() { return state.threadId; }
	function setThreadId(tid) { state.threadId = tid || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)); }

	return { client, send, cancel, getThreadId, setThreadId };
}
