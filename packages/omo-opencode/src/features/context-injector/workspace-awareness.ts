import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
	getPlanProgress,
	NOTEPAD_BASE_PATH,
	PROMETHEUS_PLANS_DIR,
} from "@oh-my-opencode/boulder-state";

const DEFAULT_MAX_BYTES = 4_096;
const DEFAULT_MEMORY_TIMEOUT_MS = 200;
const DEFAULT_PLAN_LIMIT = 3;
const DEFAULT_DECISION_LIMIT = 3;
const DEFAULT_MEMORY_FACT_LIMIT = 2;

export interface WorkspaceMemoryFact {
	source: string;
	content: string;
}

export interface WorkspaceMemoryReaderArgs {
	sessionID: string;
	workspaceRoot: string;
	timeoutMs: number;
	maxFacts: number;
}

export type WorkspaceMemoryReader =
	| ((
			args: WorkspaceMemoryReaderArgs,
	  ) => Promise<WorkspaceMemoryFact[] | null> | WorkspaceMemoryFact[] | null)
	| null;

export interface WorkspaceAwarenessPacket {
	content: string;
	hasContent: boolean;
	memoryTimedOut: boolean;
	memoryFactsUsed: boolean;
	truncated: boolean;
}

export interface BuildWorkspaceAwarenessPacketArgs {
	sessionID: string;
	workspaceRoot: string;
	memoryReader?: WorkspaceMemoryReader;
	timeoutMs?: number;
	maxBytes?: number;
}

export async function buildWorkspaceAwarenessPacket(
	args: BuildWorkspaceAwarenessPacketArgs,
): Promise<WorkspaceAwarenessPacket> {
	const maxBytes = args.maxBytes ?? DEFAULT_MAX_BYTES;
	const timeoutMs = args.timeoutMs ?? DEFAULT_MEMORY_TIMEOUT_MS;

	const sections: string[] = [];
	const append = createBudgetedAppender(sections, maxBytes);

	const planLines = safeCollectLines(() =>
		collectPlanSummaries(args.workspaceRoot),
	);
	if (planLines.length > 0) {
		append("## Workspace awareness");
		append("### Plans");
		for (const line of planLines.slice(0, DEFAULT_PLAN_LIMIT)) {
			append(line);
		}
	}

	const decisionLines = safeCollectLines(() =>
		collectDecisionSummaries(args.workspaceRoot),
	);
	if (decisionLines.length > 0) {
		append("### Recent decisions");
		for (const line of decisionLines.slice(0, DEFAULT_DECISION_LIMIT)) {
			append(line);
		}
	}

	const continuationLines = safeCollectLines(() =>
		collectRunContinuationSummaries(args.workspaceRoot),
	);
	if (continuationLines.length > 0) {
		append("### Run continuation");
		for (const line of continuationLines) {
			append(line);
		}
	}

	const memoryResult = await readMemoryFacts({
		memoryReader: args.memoryReader ?? null,
		sessionID: args.sessionID,
		workspaceRoot: args.workspaceRoot,
		timeoutMs,
		maxFacts: DEFAULT_MEMORY_FACT_LIMIT,
	});

	if (memoryResult.facts.length > 0) {
		append("### Durable memory");
		for (const fact of memoryResult.facts) {
			append(`- ${fact.source}: ${normalizeWhitespace(fact.content, 240)}`);
		}
	}

	const content = sections.join("\n");
	return {
		content,
		hasContent: content.trim().length > 0,
		memoryTimedOut: memoryResult.timedOut,
		memoryFactsUsed: memoryResult.facts.length > 0,
		truncated: append.truncated,
	};
}

function collectPlanSummaries(workspaceRoot: string): string[] {
	const plansDir = join(workspaceRoot, PROMETHEUS_PLANS_DIR);
	if (!existsSync(plansDir)) {
		return [];
	}

	const planFiles = readdirSync(plansDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => join(plansDir, entry.name))
		.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

	return planFiles.map((planPath) => {
		const content = readFileSync(planPath, "utf8");
		const title = extractHeading(content) ?? basename(planPath, ".md");
		const progress = getPlanProgress(planPath);
		const status =
			progress.total === 0
				? "no tracked tasks"
				: `${progress.completed}/${progress.total} complete${progress.isComplete ? " (complete)" : ""}`;

		return `- ${basename(planPath, ".md")}: ${status}${title ? ` — ${title}` : ""}`;
	});
}

function collectDecisionSummaries(workspaceRoot: string): string[] {
	const notepadsRoot = join(workspaceRoot, NOTEPAD_BASE_PATH);
	if (!existsSync(notepadsRoot)) {
		return [];
	}

	const decisionFiles = readdirSync(notepadsRoot, { withFileTypes: true })
		.flatMap((entry) => {
			if (entry.isDirectory()) {
				const decisionsPath = join(notepadsRoot, entry.name, "decisions.md");
				return existsSync(decisionsPath) ? [decisionsPath] : [];
			}

			if (entry.isFile() && entry.name === "decisions.md") {
				return [join(notepadsRoot, entry.name)];
			}

			return [];
		})
		.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

	const lines: string[] = [];
	for (const decisionPath of decisionFiles) {
		const noteName = basename(decisionPath, ".md");
		const recentLines = readFileSync(decisionPath, "utf8")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.slice(-DEFAULT_DECISION_LIMIT);

		for (const line of recentLines) {
			lines.push(`- ${noteName}: ${normalizeWhitespace(line, 240)}`);
		}
	}

	return lines;
}

function collectRunContinuationSummaries(workspaceRoot: string): string[] {
	const continuationRoot = join(workspaceRoot, ".omo", "run-continuation");
	if (!existsSync(continuationRoot)) {
		return [];
	}

	const files = readdirSync(continuationRoot, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
		.map((entry) => join(continuationRoot, entry.name))
		.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

	const lines: string[] = [];
	for (const filePath of files) {
		try {
			const state = JSON.parse(readFileSync(filePath, "utf8")) as {
				sessionID?: string;
				sources?: Record<string, { state?: string }>;
			};

			const activeSources = Object.entries(state.sources ?? {})
				.filter(([, source]) => source?.state !== undefined)
				.map(([sourceName, source]) => `${sourceName}: ${source.state}`);

			if (activeSources.length === 0) {
				continue;
			}

			const sessionID = state.sessionID ?? basename(filePath, ".json");
			lines.push(`- ${sessionID}: ${activeSources.join(", ")}`);
		} catch (error) {
			void error;
		}
	}

	return lines;
}

function extractHeading(content: string): string | undefined {
	const heading = content.split(/\r?\n/).find((line) => /^#\s+/.test(line));

	return heading?.replace(/^#\s+/, "").trim();
}

async function readMemoryFacts(args: {
	memoryReader: WorkspaceMemoryReader;
	sessionID: string;
	workspaceRoot: string;
	timeoutMs: number;
	maxFacts: number;
}): Promise<{ facts: WorkspaceMemoryFact[]; timedOut: boolean }> {
	if (!args.memoryReader) {
		return { facts: [], timedOut: false };
	}

	const timeoutError = new Error("workspace-awareness-memory-timeout");
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timeoutHandle = setTimeout(() => {
			reject(timeoutError);
		}, args.timeoutMs);
	});

	try {
		const result = await Promise.race([
			Promise.resolve(
				args.memoryReader({
					sessionID: args.sessionID,
					workspaceRoot: args.workspaceRoot,
					timeoutMs: args.timeoutMs,
					maxFacts: args.maxFacts,
				}),
			),
			timeout,
		]);

		return {
			facts: normalizeMemoryFacts(
				Array.isArray(result) ? result : [],
				args.maxFacts,
			),
			timedOut: false,
		};
	} catch (error) {
		if (error instanceof Error && error.message === timeoutError.message) {
			return { facts: [], timedOut: true };
		}

		return { facts: [], timedOut: false };
	} finally {
		if (timeoutHandle !== undefined) {
			clearTimeout(timeoutHandle);
		}
	}
}

function normalizeMemoryFacts(
	facts: WorkspaceMemoryFact[],
	maxFacts: number,
): WorkspaceMemoryFact[] {
	return facts
		.filter(
			(fact) => fact.source.trim().length > 0 && fact.content.trim().length > 0,
		)
		.slice(0, maxFacts)
		.map((fact) => ({
			source: normalizeWhitespace(fact.source, 80),
			content: normalizeWhitespace(fact.content, 240),
		}));
}

function normalizeWhitespace(value: string, maxLength: number): string {
	const collapsed = value.replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxLength) {
		return collapsed;
	}

	return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeCollectLines(collector: () => string[]): string[] {
	try {
		return collector();
	} catch {
		return [];
	}
}

type BudgetedAppender = ((line: string) => void) & { truncated: boolean }

function createBudgetedAppender(
	target: string[],
	maxBytes: number,
): BudgetedAppender {
	let truncated = false;
	let currentBytes = 0;

	const append = (line: string): void => {
		if (truncated) {
			return;
		}

		const candidate = target.length === 0 ? line : `\n${line}`;
		const candidateBytes = Buffer.byteLength(candidate, "utf8");
		if (currentBytes + candidateBytes <= maxBytes) {
			target.push(line);
			currentBytes += candidateBytes;
			return;
		}

		const remaining = maxBytes - currentBytes;
		if (remaining <= 0) {
			truncated = true;
			return;
		}

		const suffix = "…";
		const availableForLine = Math.max(
			0,
			remaining -
				(target.length === 0 ? 0 : 1) -
				Buffer.byteLength(suffix, "utf8"),
		);
		if (availableForLine <= 0) {
			truncated = true;
			return;
		}

		const clipped = normalizeWhitespace(line, availableForLine);
		const finalLine = `${clipped}${suffix}`;
		const finalCandidate = target.length === 0 ? finalLine : `\n${finalLine}`;
		if (currentBytes + Buffer.byteLength(finalCandidate, "utf8") <= maxBytes) {
			target.push(finalLine);
		}
		truncated = true;
	};

	const budgetedAppend = append as BudgetedAppender

	Object.defineProperty(budgetedAppend, "truncated", {
		enumerable: true,
		get: () => truncated,
	});

	return budgetedAppend;
}
