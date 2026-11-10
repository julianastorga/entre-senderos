const pending = new WeakMap();

export function beginLoading(target, { label = "Cargando contenido", shape = "cards", count = 3, show = true } = {}) {
  if (!target) return () => {};
  const previous = pending.get(target);
  const busy = previous ? previous.busy : target.getAttribute("aria-busy");
  previous?.placeholder?.remove();
  target.classList.remove("loading-content");
  const state = { busy, placeholder: null };
  pending.set(target, state);
  target.setAttribute("aria-busy", "true");
  if (show) {
    const placeholder = document.createElement("div");
    placeholder.className = `loading-skeleton loading-${shape}`;
    placeholder.setAttribute("role", "status");
    placeholder.setAttribute("aria-live", "polite");
    const announcement = document.createElement("span");
    announcement.className = "sr-only";
    announcement.textContent = `${label}…`;
    const visuals = document.createElement("div");
    visuals.className = `skeleton-visuals skeleton-${shape}`;
    visuals.setAttribute("aria-hidden", "true");
    function block(parent, type = "line") {
      const node = document.createElement("div");
      node.className = `skeleton-block skeleton-${type}`;
      parent.append(node);
    }
    if (shape === "calendar") {
      for (let index = 0; index < 42; index += 1) block(visuals, "day");
    } else {
      for (let index = 0; index < count; index += 1) {
        const item = document.createElement("div");
        item.className = "skeleton-item";
        if (["cards", "article"].includes(shape)) block(item, "image");
        block(item, "heading");
        for (let line = 0; line < (shape === "article" ? 7 : shape === "tags" ? 1 : 3); line += 1) block(item);
        visuals.append(item);
      }
    }
    placeholder.append(announcement, visuals);
    target.before(placeholder);
    target.classList.add("loading-content");
    state.placeholder = placeholder;
  }
  return () => {
    if (pending.get(target) !== state) return;
    state.placeholder?.remove();
    target.classList.remove("loading-content");
    if (state.busy === null) target.removeAttribute("aria-busy");
    else target.setAttribute("aria-busy", state.busy);
    pending.delete(target);
  };
}
