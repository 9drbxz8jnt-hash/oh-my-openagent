export function buildMemoryCandidateContract(): string {
  return `
## Supervisor Memory Contract

- Return durable learnings as memory candidates when they may help future work.
- Do not write MemPalace directly. Sisyphus or the parent supervisor decides what is saved.
- Keep candidates brief and source-backed: fact, source, confidence, and why it matters.`
}

export function appendCollaborationContract(prompt: string, contract: string): string {
  return `${prompt.trimEnd()}\n\n${contract.trim()}`
}
