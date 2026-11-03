/*
	Le relais du synchroniseur : il ne fait que garder la consigne d'un salon et la passer aux autres.

	Un salon est un Durable Object nomme par son code. Il retient une seule chose, la derniere
	consigne (voir modules/sync.js), pour qu'un nouveau venu la recoive en entrant ; le reste est
	calcule par chaque lecteur a partir des horloges de Twitch. Quand le dernier membre part, le salon
	oublie tout.

	Les WebSockets passent par l'API a hibernation : un salon ou personne ne bouge ne coute rien, ce
	qui tient tres largement dans le plan gratuit de Cloudflare.
*/
import { DurableObject } from "cloudflare:workers";

const ROOM_PATH = /^\/room\/([A-HJ-NP-Z2-9]{6})$/;
const MAX_MEMBERS = 20;
const MAX_MESSAGE = 1024;

export default {
	async fetch(request, env) {
		const oMatch = new URL(request.url).pathname.match(ROOM_PATH);
		if (!oMatch) {
			return new Response("tw5 sync relay", { status: 404 });
		}
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected a WebSocket", { status: 426 });
		}
		return env.ROOMS.get(env.ROOMS.idFromName(oMatch[1])).fetch(request);
	},
};

export class Room extends DurableObject {
	async fetch() {
		const aoSockets = this.ctx.getWebSockets();
		if (aoSockets.length >= MAX_MEMBERS) {
			return new Response("Room full", { status: 403 });
		}
		const [oClient, oServer] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(oServer);
		const nMembers = aoSockets.length + 1;
		const oAnchor = (await this.ctx.storage.get("anchor")) ?? null;
		oServer.send(JSON.stringify({ t: "welcome", a: oAnchor, n: nMembers }));
		this.broadcast({ t: "members", n: nMembers }, oServer);
		return new Response(null, { status: 101, webSocket: oClient });
	}

	async webSocketMessage(oSocket, pMessage) {
		if (typeof pMessage != "string" || pMessage.length > MAX_MESSAGE) {
			return;
		}
		let oMessage;
		try {
			oMessage = JSON.parse(pMessage);
		} catch (_) {
			return;
		}
		if (oMessage === null || typeof oMessage != "object") {
			return;
		}
		// L'heure du relais, pour les salons qui n'ont pas celle de Twitch (une VOD) : le client mesure
		// l'aller-retour et s'y cale.
		if (oMessage.t === "ping" && Number.isFinite(oMessage.c)) {
			oSocket.send(JSON.stringify({ t: "pong", c: oMessage.c, ts: Date.now() }));
			return;
		}
		if (oMessage.t === "anchor" && oMessage.a !== null && typeof oMessage.a == "object") {
			await this.ctx.storage.put("anchor", oMessage.a);
			this.broadcast({ t: "anchor", a: oMessage.a, n: this.ctx.getWebSockets().length }, oSocket);
		}
	}

	async webSocketClose(oSocket, nCode) {
		await this.leave(oSocket, nCode);
	}

	async webSocketError(oSocket) {
		await this.leave(oSocket, 1011);
	}

	async leave(oSocket, nCode) {
		try {
			oSocket.close(nCode === 1005 || nCode === 1006 ? 1000 : nCode, "bye");
		} catch (_) {}
		const aoOthers = this.ctx.getWebSockets().filter((o) => o !== oSocket);
		if (aoOthers.length === 0) {
			await this.ctx.storage.deleteAll();
			return;
		}
		this.broadcast({ t: "members", n: aoOthers.length }, oSocket);
	}

	broadcast(oMessage, oExcept) {
		const sMessage = JSON.stringify(oMessage);
		for (const oSocket of this.ctx.getWebSockets()) {
			if (oSocket !== oExcept) {
				try {
					oSocket.send(sMessage);
				} catch (_) {}
			}
		}
	}
}
