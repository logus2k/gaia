// chat-voice-assistant.js

import { initLLM } from "./llm-bridge.js";
import { AudioResampler } from "./audioResampler.js";
import { MenuManager } from "./menu.manager.js";


export class ChatVoiceAssistant {
	constructor(opts = {}) {
		this.opts = {
			llmUrl: "http://localhost:7701",
			agent: "succint",
			sttUrl: "http://localhost:2700",
			// UI selectors
			inputSel: "#chat-input",
			sendBtnSel: "#send-button",
			cancelBtnSel: "#cancelBtn",
			micBtnSel: "#mic-toggle-btn",
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

		this._cssInjected = false;
	}

	/**
	 * Initialize after DOM is ready.
	 */
	async init() {
		this._cacheDom();
		this._bindUi();
		this._injectRecordingCssOnce();

		await this._initLlm();
		this._exposeGlobals(); // keep backward compatibility with inline onclicks
	}

	_cacheDom() {
		this.inputEl = document.querySelector(this.opts.inputSel);
		this.sendBtn = document.querySelector(this.opts.sendBtnSel);
		this.cancelBtn = document.querySelector(this.opts.cancelBtnSel);
		this.micBtn = document.querySelector(this.opts.micBtnSel);
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
	}

	async _initLlm() {
		const ui = {
			started: () => {
				this.activeAssistantBubble = (window.addMessage?.("assistant", "") ?? null);
			},
			stream: (text) => {
				if (!this.activeAssistantBubble) {
					this.activeAssistantBubble = (window.addMessage?.("assistant", "") ?? null);
				}
				if (this.activeAssistantBubble) {
					this.activeAssistantBubble.textContent = text;
				}
			},
			done: () => {
				this.activeAssistantBubble = null;
			},
			error: (e) => {
				this.activeAssistantBubble = null;
				console.error(e);
			}
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

		// Listen for server-side user transcripts and render exactly once per utterance
		const sock = this.client?.socket;
		if (sock?.off) sock.off("UserTranscript"); // avoid duplicate handlers on reconnects
		sock?.on("UserTranscript", (p = {}) => {
			const text = typeof p.text === "string" ? p.text.trim() : "";
			const isFinal = !!p.final; // your server currently only emits finals; ready for interims
			if (!text) return;

			if (isFinal) {
				// one user bubble per utterance (server is the single source of truth)
				window.addMessage?.("user", text);
			}
			// Also forward to optional callback used by your UI, if any
			this.opts.onTranscript?.(text, isFinal);
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
			console.log("[STT] Recording started successfully");
		} catch (err) {
			console.error("[STT] Failed to start recording:", err);
			this.isRecording = false;
			this._updateMicButton(false);
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
