import { REACTIONS, REACTIONS_KEY, emptyReactions, reactionSummary, setReaction } from "./reaction-model.mjs";

export async function initReactions(article, id, storage, cloud, request) {
  const section = document.createElement("section");
  section.className = "post-reactions";
  section.setAttribute("aria-label", "Reacciones a la publicación");
  const heading = document.createElement("h2");
  heading.textContent = "¿Qué te pareció?";
  const group = document.createElement("div");
  group.className = "reaction-buttons";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Reaccionar a esta publicación");
  const status = document.createElement("p");
  status.className = "small-print";
  status.setAttribute("role", "status");
  status.textContent = "Cargando reacciones…";
  const error = document.createElement("p");
  error.className = "form-status";
  error.setAttribute("role", "alert");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "text-button";
  retry.textContent = "Reintentar cargar reacciones";
  retry.hidden = true;
  section.append(heading, group, status, error, retry);
  if (!cloud) {
    const note = document.createElement("p");
    note.className = "small-print";
    note.textContent = "Vista previa: las reacciones solo se guardan en este navegador.";
    section.append(note);
  }
  const footer = article.querySelector(".story-footer");
  if (footer) footer.before(section); else article.append(section);
  let state = null;
  let busy = false;
  let visitor;
  const key = `${REACTIONS_KEY}${id}`;
  const endpoint = `/reactions?id=${encodeURIComponent(id)}`;
  const buttons = REACTIONS.map((reaction) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reaction-button";
    button.dataset.reaction = reaction.id;
    button.title = reaction.label;
    button.setAttribute("aria-label", `${reaction.label}: 0 reacciones`);
    button.setAttribute("aria-pressed", "false");
    button.disabled = true;
    const emoji = document.createElement("span");
    emoji.textContent = reaction.emoji;
    emoji.setAttribute("aria-hidden", "true");
    const count = document.createElement("span");
    count.dataset.reactionCount = "";
    count.textContent = "0";
    button.append(emoji, count);
    button.addEventListener("click", async () => {
      if (busy || !state) return;
      const active = !state.selected.includes(reaction.id);
      setBusy(true);
      status.textContent = "Guardando reacción…";
      error.textContent = "";
      try {
        let next;
        if (cloud) next = await request(endpoint, { method: "PUT", body: { reaction: reaction.id, active } });
        else {
          const record = setReaction(localRecord(), visitor, reaction.id, active);
          storage.setItem(key, JSON.stringify(record));
          next = reactionSummary(record, visitor);
        }
        if (!section.isConnected) return;
        display(next);
        status.textContent = active ? "Reacción añadida." : "Reacción retirada.";
      } catch (failure) {
        if (section.isConnected) {
          status.textContent = "";
          error.textContent = `No se pudo guardar la reacción. ${failure.message} Vuelve a intentarlo.`;
        }
      } finally {
        setBusy(false);
      }
    });
    group.append(button);
    return button;
  });
  function localRecord() {
    const raw = storage.getItem(key);
    return raw === null ? emptyReactions() : JSON.parse(raw);
  }
  function setBusy(value) {
    busy = value;
    buttons.forEach((button) => { button.disabled = value || !state; });
    retry.disabled = value;
    group.setAttribute("aria-busy", String(value));
  }
  function display(next) {
    state = next;
    REACTIONS.forEach((reaction, index) => {
      const count = state.counts[reaction.id];
      buttons[index].querySelector("[data-reaction-count]").textContent = String(count);
      buttons[index].setAttribute("aria-label", `${reaction.label}: ${count} ${count === 1 ? "reacción" : "reacciones"}`);
      buttons[index].setAttribute("aria-pressed", String(state.selected.includes(reaction.id)));
    });
  }
  async function load() {
    setBusy(true);
    error.textContent = "";
    status.textContent = "Cargando reacciones…";
    try {
      if (!cloud) {
        visitor = storage.getItem("writing-reaction-visitor:v1");
        if (!visitor) {
          visitor = crypto.randomUUID();
          storage.setItem("writing-reaction-visitor:v1", visitor);
        }
      }
      const next = cloud ? await request(endpoint) : reactionSummary(localRecord(), visitor);
      if (!section.isConnected) return;
      display(next);
      status.textContent = "";
      retry.hidden = true;
    } catch (failure) {
      if (section.isConnected) {
        status.textContent = "";
        error.textContent = `No se pudieron cargar las reacciones. ${failure.message}`;
        retry.hidden = false;
      }
    } finally {
      setBusy(false);
    }
  }
  retry.addEventListener("click", load);
  await load();
}
