import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkspaceAwarenessPacket } from "./workspace-awareness";

describe("buildWorkspaceAwarenessPacket", () => {
	it("summarizes workspace artifacts and stays under 4KB", async () => {
		// given
		const workspaceRoot = mkdtempSync(
			join(tmpdir(), "omo-workspace-awareness-"),
		);
		mkdirSync(join(workspaceRoot, ".omo", "plans"), { recursive: true });
		mkdirSync(
			join(
				workspaceRoot,
				".omo",
				"notepads",
				"runtime-hooks-agent-memory-architecture",
			),
			{
				recursive: true,
			},
		);
		mkdirSync(join(workspaceRoot, ".omo", "run-continuation"), {
			recursive: true,
		});
		mkdirSync(join(workspaceRoot, ".omo", "evidence"), { recursive: true });

		writeFileSync(
			join(
				workspaceRoot,
				".omo",
				"plans",
				"runtime-hooks-agent-memory-architecture.md",
			),
			[
				"# Runtime Hooks, Agent Memory, and Supervisor Architecture Plan",
				"",
				"## TODOs",
				"- [x] 1. task one",
				"- [ ] 2. task two",
				"",
			].join("\n"),
		);
		writeFileSync(
			join(
				workspaceRoot,
				".omo",
				"notepads",
				"runtime-hooks-agent-memory-architecture",
				"decisions.md",
			),
			[
				"2026-06-19 - Keep commit policy in Sisyphus.",
				"2026-06-20 - Keep workspace packet cold-path only.",
				"",
			].join("\n"),
		);
		writeFileSync(
			join(workspaceRoot, ".omo", "run-continuation", "ses_demo.json"),
			JSON.stringify(
				{
					sessionID: "ses_demo",
					updatedAt: "2026-06-20T05:38:52.610Z",
					sources: {
						"background-task": {
							state: "active",
							updatedAt: "2026-06-20T05:38:52.610Z",
						},
					},
				},
				null,
				2,
			),
		);
		writeFileSync(
			join(workspaceRoot, ".omo", "evidence", "raw.txt"),
			"DO_NOT_INCLUDE_THIS",
		);

		// when
		const packet = await buildWorkspaceAwarenessPacket({
			sessionID: "ses_main",
			workspaceRoot,
			memoryReader: async () => [
				{
					source: "mempalace",
					content: "Durable fact from memory",
				},
			],
			timeoutMs: 50,
			maxBytes: 4096,
		});

		// then
		expect(packet.hasContent).toBe(true);
		expect(packet.content).toContain("runtime-hooks-agent-memory-architecture");
		expect(packet.content).toContain("1/2");
		expect(packet.content).toContain("Keep commit policy in Sisyphus");
		expect(packet.content).toContain("background-task: active");
		expect(packet.content).toContain("Durable fact from memory");
		expect(packet.content).not.toContain("DO_NOT_INCLUDE_THIS");
		expect(Buffer.byteLength(packet.content, "utf8")).toBeLessThanOrEqual(4096);
	});

	it("marks the packet truncated when the byte budget is exceeded", async () => {
		// given
		const workspaceRoot = mkdtempSync(
			join(tmpdir(), "omo-workspace-awareness-truncated-"),
		);
		mkdirSync(join(workspaceRoot, ".omo", "plans"), { recursive: true });
		writeFileSync(
			join(workspaceRoot, ".omo", "plans", "truncated-plan.md"),
			[
				"# Truncated Plan",
				"",
				"## TODOs",
				`- [ ] 1. ${"workspace awareness ".repeat(20)}`,
				`- [ ] 2. ${"workspace awareness ".repeat(20)}`,
				"",
			].join("\n"),
		);

		// when
		const packet = await buildWorkspaceAwarenessPacket({
			sessionID: "ses_truncated",
			workspaceRoot,
			timeoutMs: 50,
			maxBytes: 80,
		});

		// then
		expect(packet.truncated).toBe(true);
		expect(Buffer.byteLength(packet.content, "utf8")).toBeLessThanOrEqual(80);
	});

	it("continues without memory when the reader times out", async () => {
		// given
		const workspaceRoot = mkdtempSync(
			join(tmpdir(), "omo-workspace-awareness-timeout-"),
		);
		mkdirSync(join(workspaceRoot, ".omo", "plans"), { recursive: true });
		writeFileSync(
			join(workspaceRoot, ".omo", "plans", "timeout-plan.md"),
			[
				"# Timeout Plan",
				"",
				"## TODOs",
				"- [ ] 1. keep session responsive",
				"",
			].join("\n"),
		);

		const memoryReader = async ({ timeoutMs }: { timeoutMs: number }) => {
			await new Promise((resolve) => setTimeout(resolve, timeoutMs + 20));
			return [
				{
					source: "mempalace",
					content: "Late memory fact",
				},
			];
		};

		// when
		const packet = await buildWorkspaceAwarenessPacket({
			sessionID: "ses_timeout",
			workspaceRoot,
			memoryReader,
			timeoutMs: 10,
			maxBytes: 4096,
		});

		// then
		expect(packet.memoryTimedOut).toBe(true);
		expect(packet.memoryFactsUsed).toBe(false);
		expect(packet.content).toContain("timeout-plan");
		expect(packet.content).not.toContain("Late memory fact");
	});
});
