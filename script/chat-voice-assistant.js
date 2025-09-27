// chat-voice-assistant.js

import { initLLM } from "./llm-bridge.js";
import { AudioResampler } from "./audioResampler.js";
import { MenuManager } from "./menu.manager.js";
import { LocationSearchClient } from "./location.search.client.js";
import { RouterListener } from "./router-listener.js";



export class ChatVoiceAssistant {
	constructor(opts = {}) {
		this.opts = {
			llmUrl: "http://localhost:7701",
			agent: "topic",
			sttUrl: "http://localhost:2700",
			ttsUrl: "http://localhost:7700",
			// UI selectors
			inputSel: "#chat-input",
			sendBtnSel: "#send-button",
			cancelBtnSel: "#cancelBtn",
			micBtnSel: "#mic-toggle-btn",
			ttsBtnSel: "#tts-toggle-btn",
			voiceBtnSel: "#voice-toggle-btn",
			recorderWorkletUrl: "./script/recorder.worklet.js",
			// callbacks (optional)
			onTranscript: null,	// (text, isFinal) => {}
			...opts
		};

		// DOM
		this.inputEl = null;
		this.sendBtn = null;
		this.cancelBtn = null;
		this.micBtn = null;

		// Chat state
		this.activeAssistantBubble = null;
        this._toggling = false;        

		// LLM
		this.client = null;
		this.send = null;
		this.cancel = null;
		this.getThreadId = null;

		// STT
		this.sttSocket = null;
		this.audioCtx = null;
		this.mediaStream = null;
		this.sourceNode = null;
		this.workletNode = null;
		this.resampler = null;
		this.isRecording = false;
		this.packetsProcessed = 0;

		// TTS
		this.ttsSocket = null;
		this.ttsEnabled = false;
		this.ttsPlayCtx = null;
		this.ttsPlayQueue = Promise.resolve();	
		
		this._cssInjected = false;

		
		// Initialize the search client to integrate its results with globe interaction
		this.searchClient = null;
	}

	/**
	 * Initialize after DOM is ready.
	 */
	async init() {
		this._cacheDom();
		this._bindUi();
		this._injectRecordingCssOnce();

		await this._initLlm();

		this.searchClient = new LocationSearchClient();
		this.searchClient.initialize();

		this._wireTranscriptHandlers();

		window.addEventListener("beforeunload", () => {
			try { this.ttsSocket?.disconnect(); } catch {}
			this._closeTtsAudioContext();
		});		

		this._exposeGlobals(); // keep backward compatibility with inline onclicks
	}

	_cacheDom() {
		this.inputEl = document.querySelector(this.opts.inputSel);
		this.sendBtn = document.querySelector(this.opts.sendBtnSel);
		this.cancelBtn = document.querySelector(this.opts.cancelBtnSel);
		this.micBtn = document.querySelector(this.opts.micBtnSel);
		this.ttsBtn = document.querySelector(this.opts.ttsBtnSel);
		this.voiceBtn = document.querySelector(this.opts.voiceBtnSel);
	}

	_bindUi() {
		if (this.sendBtn) {
			this.sendBtn.addEventListener("click", () => this.doSend());
		}
		if (this.inputEl) {
			this.inputEl.addEventListener("keydown", (e) => {
				if (e.isComposing) return;
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					this.doSend();
				}
			});
		}
		if (this.cancelBtn) {
			this.cancelBtn.addEventListener("click", () => this.cancel?.());
		}
		if (this.micBtn) {
			this.micBtn.addEventListener("click", () => this.toggleRecording());
		}
		if (this.ttsBtn) {
			this.ttsBtn.addEventListener("click", () => this.toggleTTS());
		}
		if (this.voiceBtn) {
			this.voiceBtn.addEventListener("click", () => this.toggleVoice());
		}		
	}

	_wireTranscriptHandlers() {
		if (!this.client?.onTranscripts) {
			console.warn("[ChatVoiceAssistant] agent client missing onTranscripts()");
			return;
		}

		this.client.onTranscripts({
			onInterim: ({ text }) => {
				// show interim somewhere lightweight (optional)
				this._updateLiveCaption(text);
				// still give external listeners a chance
				this.opts.onTranscript?.(text, false);
			},
			onFinal: ({ text }) => {
				const t = (text || "").trim();
				if (!t) return;

				// commit exactly one user bubble per utterance
				window.addMessage?.("user", t);

				// clear interim caption
				this._updateLiveCaption("");

				// external hook
				this.opts.onTranscript?.(t, true);
			}
		});
	}	

	async _initLlm() {

		const ui = {
			started: () => {
				this.activeAssistantBubble = (window.addMessage?.("assistant", "") ?? null);
				if (this.opts.ttsHalfDuplex && this.isRecording) {
					// pause mic while TTS will play
					this.stopRecording().catch(()=>{});
				}
			},
			stream: (text) => {
				if (!this.activeAssistantBubble) {
					this.activeAssistantBubble = (window.addMessage?.("assistant", "") ?? null);
				}
				if (this.activeAssistantBubble) {
					// Parse Markdown → HTML (marked must be loaded on the page)
					const html = window.marked?.parse ? window.marked.parse(text) : text;

					// (Recommended) sanitize if DOMPurify is available
					this.activeAssistantBubble.innerHTML = window.DOMPurify
						? window.DOMPurify.sanitize(html)
						: html;

					// (Optional) syntax highlight if highlight.js is present
					if (window.hljs) {
						this.activeAssistantBubble
							.querySelectorAll("pre code")
							.forEach((el) => window.hljs.highlightElement(el));
					}

					// Keep the newest content in view while streaming
					const chatWindow = document.getElementById("chat-messages");
					if (chatWindow) chatWindow.scrollTop = chatWindow.scrollHeight;
				}
			},
			done: () => { this.activeAssistantBubble = null; },
			error: (e) => { this.activeAssistantBubble = null; console.error(e); }
		};

		const { client, send, cancel, getThreadId } = await initLLM({
			url: this.opts.llmUrl,
			agent: this.opts.agent,
			onStarted: ui.started,
			onText: ui.stream,
			onDone: ui.done,
			onError: ui.error,
			onReconnect: () => {}
		});

		this.client = client;
		this.send = send;
		this.cancel = cancel;
		this.getThreadId = getThreadId;

		this.#initRouterAgent(this.client);
	}

	#initRouterAgent(client) {

		const router = new RouterListener(client.socket, async (msg) => {
			
			if (msg && msg.Operation && msg.Operation === "LOCATE") {
				
				const searchTerm = msg.Term;
				const items = this.searchClient.search(searchTerm);
				let searchResultId = null;

				if (items && items.length > 0) {

					searchResultId = items[0].id;
					const locationDetails = await this.searchClient.getLocationDetails(searchResultId);
					
					if (locationDetails) {
						const locationId = locationDetails.id;

						if (locationId) {
							await window.handleLocationSelection?.(locationId);
						}
					}
				}
			}
		});
	}

	/**
	 * Send the current input value to the LLM, append user bubble, clear input.
	 */
	async doSend() {
		const el = this.inputEl;
		if (!el) return;
		const text = el.value.trim();
		if (!text) return;

		// remove the static template assistant bubble once, if present
		const template = document.getElementById("message-bubble");
		if (template) {
			const parentMsg = template.closest(".message.assistant");
			if (parentMsg) parentMsg.remove();
		}

		// append user message to history
		window.addMessage?.("user", text);

		// clear input
		el.value = "";
		await this.send?.(text);
	}

	/**
	 * Subscribe server-side to STT for the current thread.
	 */
	async _ensureSttSubscribed() {
		const threadId = this.getThreadId?.();
		await this.client?.sttSubscribe({
			sttUrl: this.opts.sttUrl,
			clientId: window.__clientId || (window.__clientId = (crypto.randomUUID?.() || Math.random().toString(36).slice(2))),
			agent: this.opts.agent,
			threadId
		});
		console.log("[STT] Subscribed with threadId:", threadId);
	}

	/**
	 * Ensure a socket is connected to the STT server (expects global `io` from socket.io-client).
	 */
	async _ensureSttSocket() {

		if (this.sttSocket?.connected) return;

		this.sttSocket = window.io?.(this.opts.sttUrl, { transports: ["websocket"] });
		if (!this.sttSocket) {
			throw new Error("socket.io client (io) is not available on window. Include it before using STT.");
		}
		await new Promise((resolve, reject) => {
			this.sttSocket.once("connect", resolve);
			this.sttSocket.once("connect_error", reject);
		});

		console.log("[STT] Socket connected");
	}

	async startRecording() {
		if (this.isRecording) return;
		this.isRecording = true;
		console.log("[STT] Starting recording...");

		try {
			await this._ensureSttSubscribed();
			await this._ensureSttSocket();

			// 3) Mic
			this.mediaStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: false
				}
			});
			console.log("[STT] Got media stream");

			// 4) AudioContext
			this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
				sampleRate: 48000,
				latencyHint: "interactive"
			});
            await this.audioCtx.resume();            
			console.log("[STT] Audio context created, sample rate:", this.audioCtx.sampleRate);

			// 5) Worklet
			await this.audioCtx.audioWorklet.addModule(this.opts.recorderWorkletUrl);
			this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
			this.workletNode = new AudioWorkletNode(this.audioCtx, "recorder-worklet", {
				numberOfInputs: 1,
				numberOfOutputs: 0,
				channelCount: 1,
				channelCountMode: "explicit"
			});
			this.sourceNode.connect(this.workletNode);
			console.log("[STT] Audio graph connected");

			// 6) Resampler 48k -> 16k
			this.resampler = new AudioResampler(this.audioCtx.sampleRate, 16000);

			// 7) Packetize ~100ms
			let pending = [];
			let pendingLength = 0;
			const PACKET_MS = 100;
			const sampleRate = this.audioCtx.sampleRate;
			this.packetsProcessed = 0;

			this.workletNode.port.onmessage = (e) => {
				if (!this.isRecording) return;
				const chunk = e.data;
				if (!chunk?.length) return;

				pending.push(chunk);
				pendingLength += chunk.length;

				const samplesPerPacket = Math.round(sampleRate * (PACKET_MS / 1000));
				if (pendingLength >= samplesPerPacket) {
					const merged = new Float32Array(pendingLength);
					let offset = 0;
					for (const part of pending) {
						merged.set(part, offset);
						offset += part.length;
					}
					pending = [];
					pendingLength = 0;

					if (!this.isRecording || !this.resampler || !this.sttSocket) return;
					try {
						const pcm16 = this.resampler.pushFloat32(merged);
						if (pcm16?.length > 0 && this.sttSocket.connected) {
							this.sttSocket.emit("audio_data", {
								clientId: window.__clientId,
								audioData: pcm16.buffer
							});
							this.packetsProcessed++;
							if (this.packetsProcessed === 1) {
								console.log("[STT] First audio packet sent - recording active");
							}
						}
					} catch (err) {
						console.error("[STT] Error processing audio:", err);
					}
				}
			};

			this.workletNode.port.start();
			this._updateMicButton(true);
			this._updateVoiceButton();

			console.log("[STT] Recording started successfully");

		} catch (err) {

			console.error("[STT] Failed to start recording:", err);

			this.isRecording = false;
			this._updateMicButton(false);
			this._updateVoiceButton();

			await this.stopRecording();
		}
	}

	async stopRecording() {
		if (!this.isRecording && !this.audioCtx && !this.mediaStream) return;

		console.log("[STT] Stopping recording...");
		this.isRecording = false;

		try {
			if (this.workletNode?.port) {
				this.workletNode.port.onmessage = null;
				try { this.workletNode.port.close(); } catch {}
			}

			if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch {} }
			if (this.workletNode) { try { this.workletNode.disconnect(); } catch {} }

			if (this.mediaStream) {
				this.mediaStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
			}

			if (this.audioCtx && this.audioCtx.state !== "closed") {
				try { await this.audioCtx.close(); } catch {}
			}

			if (this.resampler) {
				try { this.resampler.reset(); } catch {}
			}

			this._updateMicButton(false);
			this._updateVoiceButton();

			console.log("[STT] Recording stopped");

		} finally {
			this.audioCtx = null;
			this.sourceNode = null;
			this.workletNode = null;
			this.resampler = null;
			this.mediaStream = null;
		}
	}

    async toggleRecording() {
        if (this._toggling) return;
        this._toggling = true;
        try {
            if (this.isRecording) {
                await this.stopRecording();
            } else {
                await this.startRecording();
            }
        } finally {
            this._toggling = false;
        }

		console.log("[IDs]", { clientId: window.__clientId, threadId: this.getThreadId?.() });		
    }

	/** ---------- TTS: public toggle ---------- **/
	async toggleTTS() {
		if (this.ttsEnabled) {
			await this._disableTTS();
		} else {
			await this._enableTTS();
		}

		console.log("[IDs]", { clientId: window.__clientId, threadId: this.getThreadId?.() });		
	}

	async _enableTTS() {
		if (this.ttsEnabled) return;
		const clientId = window.__clientId || (window.__clientId = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)));

		// 1) Tell agent_server to stream assistant text to TTS for this client
		try {
			await this.client.ttsSubscribe({ clientId });	// voice/speed can be added later
		} catch (e) {
			console.error("[TTS] subscribe via agent_server failed:", e);
			// carry on; we still connect the audio sink and can retry later
		}

		// 2) Connect this browser to the TTS server as the audio sink
		await this._ensureTtsSocket(clientId);

		this.ttsEnabled = true;
		
		this._updateTtsButton(true);
		this._updateVoiceButton();

		console.log("[TTS] enabled");
	}

	async _disableTTS() {
		if (!this.ttsEnabled) return;

		// Best-effort: tell agent_server to stop streaming to TTS
		try {
			const clientId = window.__clientId;
			if (clientId) await this.client.ttsUnsubscribe({ clientId });
		} catch (e) {
			console.warn("[TTS] ttsUnsubscribe:", e?.message || e);
		}

		// Disconnect audio sink and close playback context
		try { this.ttsSocket?.disconnect(); } catch {}
		this.ttsSocket = null;
		await this._closeTtsAudioContext();

		this.ttsEnabled = false;

		this._updateTtsButton(false);
		this._updateVoiceButton();

		console.log("[TTS] disabled");
	}

	_updateTtsButton(on) {
		const btn = this.ttsBtn;
		if (!btn) return;
		const icon = btn.querySelector(".material-symbols-outlined");
		if (on) {
			btn.classList.add("recording");				// reuse style glow if you like
			btn.setAttribute("data-tooltip", "TTS: ON (click to turn OFF)");
			if (icon) icon.textContent = "volume_up";
		} else {
			btn.classList.remove("recording");
			btn.setAttribute("data-tooltip", "TTS: OFF (click to turn ON)");
			if (icon) icon.textContent = "volume_off";
		}
	}

	/** ---------- TTS: Socket.IO sink + playback ---------- **/
	async _ensureTtsSocket(clientId) {
		if (this.ttsSocket?.connected) return;

		if (!window.io) throw new Error("socket.io client not available (window.io)");
		const socket = window.io(this.opts.ttsUrl, {
			path: "/socket.io",
			transports: ["websocket"],
			forceNew: true,
			query: { type: "browser", format: "binary", main_client_id: clientId }
		});

		await new Promise((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("connect_error", reject);
			socket.once("error", reject);
		});

		// Register this socket as the audio sink for clientId
		await new Promise((resolve, reject) => {
			socket.emit("register_audio_client",
				{ main_client_id: clientId, connection_type: "browser", mode: "tts" },
				() => resolve()
			);
		});

		// Binary audio chunks -> queued playback
		socket.on("tts_audio_chunk", async (evt) => {
			const buf = evt?.audio_buffer;
			if (!buf) return;
			const actx = this._ensureTtsAudioContext();
			let audioBuf;
			try {
				// decodeAudioData consumes the buffer; pass a copy
				audioBuf = await actx.decodeAudioData(buf.slice(0));
			} catch (e) {
				console.warn("[TTS] decodeAudioData failed:", e);
				return;
			}
			this.ttsPlayQueue = this.ttsPlayQueue.then(() => {
				const src = actx.createBufferSource();
				src.buffer = audioBuf;
				src.connect(actx.destination);
				src.start();
				return new Promise(res => { src.onended = res; });
			});
		});

		socket.on("tts_stop_immediate", () => {
			this._closeTtsAudioContext();
		});

		socket.on("disconnect", (reason) => {
			console.log("[TTS] disconnect:", reason);
		});

		this.ttsSocket = socket;
	}

	_ensureTtsAudioContext() {
		if (!this.ttsPlayCtx) {
			this.ttsPlayCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
		}
		return this.ttsPlayCtx;
	}

	async _closeTtsAudioContext() {
		if (this.ttsPlayCtx) {
			try { await this.ttsPlayCtx.close(); } catch {}
			this.ttsPlayCtx = null;
		}
		this.ttsPlayQueue = Promise.resolve();
	}


	_updateMicButton(recording) {
		const micBtn = this.micBtn;
		if (!micBtn) return;
		const icon = micBtn.querySelector(".material-symbols-outlined");

		if (recording) {
			micBtn.classList.add("recording");
			micBtn.setAttribute("data-tooltip", "Stop recording");
			if (icon) icon.textContent = "stop_circle";
		} else {
			micBtn.classList.remove("recording");
			micBtn.setAttribute("data-tooltip", "Start recording");
			if (icon) icon.textContent = "mic";
		}
	}

	_injectRecordingCssOnce() {
		if (this._cssInjected) return;
		this._cssInjected = true;

		const style = document.createElement("style");
		style.textContent = `
			.menu-btn.recording {
				background: rgba(255, 67, 54, 0.2);
				border-color: #ff4336;
			}
			.menu-btn.recording .material-symbols-outlined {
				color: #ff4336;
				animation: pulse 1.5s infinite;
			}
			@keyframes pulse {
				0% { opacity: 1; }
				50% { opacity: 0.6; }
				100% { opacity: 1; }
			}
		`;
		document.head.appendChild(style);
	}

	async toggleVoice() {
		const bothOn = this.isRecording && this.ttsEnabled;

		if (bothOn) {
			// turn both OFF (best-effort, independent)
			await Promise.allSettled([this.stopRecording(), this._disableTTS()]);
		} else {
			// turn both ON (best-effort, independent)
			// STT path already ensures server subscription in startRecording()
			const ops = [];
			if (!this.isRecording) ops.push(this.startRecording());
			if (!this.ttsEnabled) ops.push(this._enableTTS());
			await Promise.allSettled(ops);
		}

		this._updateVoiceButton(); // keep the combined button state fresh
	}

	_updateVoiceButton() {
		const btn = this.voiceBtn;
		if (!btn) return;

		const icon = btn.querySelector(".material-symbols-outlined");
		const stt = !!this.isRecording;
		const tts = !!this.ttsEnabled;

		if (stt && tts) {
			btn.classList.add("recording");
			btn.setAttribute("data-tooltip", "Voice I/O: ON (click to turn OFF)");
			if (icon) icon.textContent = "mic";
		} else if (stt && !tts) {
			btn.classList.add("recording");
			btn.setAttribute("data-tooltip", "STT only (click to turn ON TTS too)");
			if (icon) icon.textContent = "mic";
		} else if (!stt && tts) {
			btn.classList.add("recording");
			btn.setAttribute("data-tooltip", "TTS only (click to turn ON STT too)");
			if (icon) icon.textContent = "volume_up";
		} else {
			btn.classList.remove("recording");
			btn.setAttribute("data-tooltip", "Voice I/O: OFF (click to turn ON)");
			if (icon) icon.textContent = "mic_off";
		}
	}

	_exposeGlobals() {
		// Keep backward compatibility with any inline onclicks
		window.toggleRecording = this.toggleRecording.bind(this);
		window.startRecording = this.startRecording.bind(this);
		window.stopRecording = this.stopRecording.bind(this);
	}

	initMenuManager(opts = {}) {
	    const menu = new MenuManager({
	 		menuPosition: "top-right",
	 		iconSize: 40,
	 		initialVisibility: {
	 			settings: false,
	 			search: false,
	 			data: false,
	 			assistant: false,
	 			about: false
	 		},
	 		...opts
	 	});
	 	window.menuManager = menu;
	 	return menu;
	}

	initColorPicker(selector = "#sel-border-color") {
		if (!window.Coloris) {
			console.warn("Coloris global not found. Include its script before calling initColorPicker().");
			return;
		}
		window.Coloris({
			el: selector,
			format: "hex",
			alpha: true,
			theme: "pill",
			themeMode: "light"
		});
	}
}
