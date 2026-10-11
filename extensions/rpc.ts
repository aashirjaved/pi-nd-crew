import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Minimal client for pi-subagents' in-process event-bus RPC (v1). */
export interface RpcReply<T = unknown> {
	version: 1;
	requestId: string;
	success: boolean;
	data?: T;
	error?: { code: string; message: string };
}

export class SubagentsRpc {
	ready = false;
	capabilities: Record<string, unknown> = {};

	constructor(private readonly pi: ExtensionAPI) {
		pi.events.on("subagents:rpc:v1:ready", () => {
			void this.ping();
		});
	}

	async ping(): Promise<boolean> {
		try {
			const data = await this.call<{ capabilities?: Record<string, unknown> }>("ping", {}, 2000);
			this.capabilities = data?.capabilities ?? {};
			this.ready = true;
		} catch {
			this.ready = false;
		}
		return this.ready;
	}

	call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
		const requestId = randomUUID();
		return new Promise<T>((resolve, reject) => {
			let unsubscribe: (() => void) | undefined;
			const timer = setTimeout(() => {
				unsubscribe?.();
				reject(new Error(`pi-subagents rpc '${method}' timed out (is pi-subagents installed?)`));
			}, timeoutMs);
			timer.unref?.();
			unsubscribe = this.pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (raw) => {
				clearTimeout(timer);
				unsubscribe?.();
				const reply = raw as RpcReply<T>;
				if (reply.success) resolve(reply.data as T);
				else reject(new Error(reply.error?.message ?? `pi-subagents rpc '${method}' failed`));
			});
			this.pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params });
		});
	}
}
