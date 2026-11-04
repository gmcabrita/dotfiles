import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;

function frame(opcode, payload = Buffer.alloc(0)) {
	const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
	const mask = randomBytes(4);
	let header;
	if (body.length < 126) {
		header = Buffer.alloc(2);
		header[1] = 0x80 | body.length;
	} else if (body.length <= 0xffff) {
		header = Buffer.alloc(4);
		header[1] = 0x80 | 126;
		header.writeUInt16BE(body.length, 2);
	} else {
		header = Buffer.alloc(10);
		header[1] = 0x80 | 127;
		header.writeBigUInt64BE(BigInt(body.length), 2);
	}
	header[0] = 0x80 | opcode;
	const masked = Buffer.allocUnsafe(body.length);
	for (let i = 0; i < body.length; i++) masked[i] = body[i] ^ mask[i % 4];
	return Buffer.concat([header, mask, masked]);
}

export class WebSocketConnection {
	#socket;
	#buffer = Buffer.alloc(0);
	#fragmentOpcode = null;
	#fragments = [];
	#closed = false;
	#messageHandlers = new Set();
	#closeHandlers = new Set();

	constructor(socket, head = Buffer.alloc(0)) {
		this.#socket = socket;
		socket.on("data", (chunk) => this.#consume(chunk));
		socket.on("error", (error) => this.#finish(error));
		socket.on("close", () => this.#finish());
		if (head.length) this.#consume(head);
	}

	onMessage(handler) {
		this.#messageHandlers.add(handler);
		return () => this.#messageHandlers.delete(handler);
	}

	onClose(handler) {
		this.#closeHandlers.add(handler);
		return () => this.#closeHandlers.delete(handler);
	}

	sendText(text) {
		if (this.#closed) throw new Error("WebSocket is closed");
		this.#socket.write(frame(0x1, Buffer.from(text)));
	}

	close() {
		if (this.#closed) return;
		this.#socket.end(frame(0x8));
		this.#finish();
	}

	#finish(error) {
		if (this.#closed) return;
		this.#closed = true;
		for (const handler of this.#closeHandlers) handler(error);
	}

	#consume(chunk) {
		try {
			this.#buffer = Buffer.concat([this.#buffer, chunk]);
			while (this.#buffer.length >= 2) {
				const first = this.#buffer[0];
				const second = this.#buffer[1];
				const fin = Boolean(first & 0x80);
				const opcode = first & 0x0f;
				const masked = Boolean(second & 0x80);
				let length = second & 0x7f;
				let offset = 2;

				if (length === 126) {
					if (this.#buffer.length < 4) return;
					length = this.#buffer.readUInt16BE(2);
					offset = 4;
				} else if (length === 127) {
					if (this.#buffer.length < 10) return;
					const wide = this.#buffer.readBigUInt64BE(2);
					if (wide > BigInt(MAX_FRAME_BYTES))
						throw new Error("WebSocket frame is too large");
					length = Number(wide);
					offset = 10;
				}
				if (length > MAX_FRAME_BYTES)
					throw new Error("WebSocket frame is too large");

				const maskBytes = masked ? 4 : 0;
				if (this.#buffer.length < offset + maskBytes + length) return;
				const mask = masked ? this.#buffer.subarray(offset, offset + 4) : null;
				offset += maskBytes;
				const payload = Buffer.from(
					this.#buffer.subarray(offset, offset + length),
				);
				this.#buffer = this.#buffer.subarray(offset + length);
				if (mask)
					for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];

				if (opcode === 0x8) {
					this.#socket.end(frame(0x8));
					this.#finish();
					return;
				}
				if (opcode === 0x9) {
					this.#socket.write(frame(0xa, payload));
					continue;
				}
				if (opcode === 0xa) continue;

				if (opcode === 0x1 || opcode === 0x2) {
					this.#fragmentOpcode = opcode;
					this.#fragments = [payload];
				} else if (opcode === 0x0 && this.#fragmentOpcode !== null) {
					this.#fragments.push(payload);
				} else {
					continue;
				}

				if (fin) {
					const complete = Buffer.concat(this.#fragments);
					const messageOpcode = this.#fragmentOpcode;
					this.#fragmentOpcode = null;
					this.#fragments = [];
					if (messageOpcode === 0x1) {
						const text = complete.toString("utf8");
						for (const handler of this.#messageHandlers) handler(text);
					}
				}
			}
		} catch (error) {
			this.#socket.destroy();
			this.#finish(error);
		}
	}
}

export function connectWebSocket(
	endpoint,
	extraHeaders = {},
	timeout = 15_000,
) {
	return new Promise((resolve, reject) => {
		const url = new URL(endpoint);
		if (!["ws:", "wss:"].includes(url.protocol)) {
			reject(
				new Error(`Expected a ws:// or wss:// endpoint, got ${url.protocol}`),
			);
			return;
		}

		const key = randomBytes(16).toString("base64");
		const expectedAccept = createHash("sha1")
			.update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
			.digest("base64");
		const transport = url.protocol === "wss:" ? https : http;
		const request = transport.request({
			hostname: url.hostname,
			port: url.port || undefined,
			path: `${url.pathname}${url.search}`,
			method: "GET",
			headers: {
				Connection: "Upgrade",
				Upgrade: "websocket",
				"Sec-WebSocket-Key": key,
				"Sec-WebSocket-Version": "13",
				...extraHeaders,
			},
		});

		const timer = setTimeout(
			() => request.destroy(new Error("WebSocket connection timed out")),
			timeout,
		);
		request.once("upgrade", (response, socket, head) => {
			clearTimeout(timer);
			if (
				response.statusCode !== 101 ||
				response.headers["sec-websocket-accept"] !== expectedAccept
			) {
				socket.destroy();
				reject(new Error("Invalid WebSocket upgrade response"));
				return;
			}
			resolve(new WebSocketConnection(socket, head));
		});
		request.once("response", (response) => {
			clearTimeout(timer);
			response.resume();
			reject(
				new Error(`WebSocket upgrade failed: HTTP ${response.statusCode}`),
			);
		});
		request.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		request.end();
	});
}
