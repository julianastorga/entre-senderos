export const REACTIONS = Object.freeze([
  { id: "heart", emoji: "\u2764\uFE0F", label: "Me encanta" },
  { id: "fire", emoji: "\u{1F525}", label: "Genial" },
  { id: "laugh", emoji: "\u{1F602}", label: "Me divierte" },
  { id: "applause", emoji: "\u{1F44F}", label: "Aplausos" },
  { id: "surprise", emoji: "\u{1F62E}", label: "Me sorprende" },
  { id: "thinking", emoji: "\u{1F914}", label: "Me hace pensar" },
].map(Object.freeze));
export const REACTIONS_KEY = "writing-reactions:v1:";

export function emptyReactions() {
  return { version: 1, counts: Object.fromEntries(REACTIONS.map(({ id }) => [id, 0])), voters: {} };
}

export function reactionSummary(record, visitor) {
  return { counts: { ...record.counts }, selected: [...(record.voters[visitor] || [])] };
}

export function setReaction(record, visitor, reaction, active) {
  if (!REACTIONS.some(({ id }) => id === reaction) || typeof active !== "boolean") throw new Error("Elige una reacción válida e indica si deseas activarla.");
  const selected = new Set(record.voters[visitor] || []);
  if (selected.has(reaction) === active) return record;
  if (active) selected.add(reaction); else selected.delete(reaction);
  const voters = { ...record.voters };
  if (selected.size) voters[visitor] = [...selected]; else delete voters[visitor];
  return { version: 1, counts: { ...record.counts, [reaction]: record.counts[reaction] + (active ? 1 : -1) }, voters };
}
