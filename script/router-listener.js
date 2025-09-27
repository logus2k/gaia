// router-listener.js


export class RouterListener {

    /**
     * @param {import("socket.io-client").Socket} socket - connected socket
     * @param {(payload:any)=>void} onMessage          - called with payload as-is
     * @param {string} [eventName="RouterResult"]
     */
    constructor(socket, onMessage, eventName = "RouterResult") {
        this.socket = socket;
        this.onMessage = onMessage;
        this.eventName = eventName;
        this._handler = (payload) => { try { this.onMessage?.(payload); } catch (e) { console.error(e); } };
        socket.on(eventName, this._handler); // Socket.IO keeps handlers across reconnects
    }

    destroy() {
        try { this.socket.off(this.eventName, this._handler); } catch { }
        this.socket = null;
        this.onMessage = null;
    }

    // Optional helper to fire a router query
    query(text) { this.socket?.emit("RouterQuery", { text }); }
}
