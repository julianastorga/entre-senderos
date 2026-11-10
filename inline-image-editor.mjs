export function createInlineImageEditor(editor, onChanged) {
  const controls = document.querySelector("#inline-image-actions");
  const description = document.querySelector("#inline-image-selected");
  const status = document.querySelector("#inline-image-move-status");
  const before = document.querySelector("#move-image-before");
  const after = document.querySelector("#move-image-after");
  const place = document.querySelector("#place-image-at-cursor");
  let selected = null;
  let destination = null;

  function block(image, root) {
    let node = image;
    while (node.parentNode !== root) node = node.parentNode;
    return node;
  }
  function embedded(image, anchor) {
    return anchor !== image && (anchor.textContent.trim() || anchor.querySelectorAll("img").length > 1);
  }
  function neighbor(anchor, direction) {
    let node = direction === "before" ? anchor.previousSibling : anchor.nextSibling;
    while (node?.nodeType === Node.TEXT_NODE && !node.textContent.trim()) node = direction === "before" ? node.previousSibling : node.nextSibling;
    return node;
  }
  function refresh() {
    editor.querySelectorAll("img").forEach((image) => {
      image.tabIndex = 0;
      image.setAttribute("aria-describedby", "inline-image-move-help");
    });
    selected = editor.querySelector("img.editor-image-selected");
    controls.hidden = !selected;
    if (!selected) { destination = null; return; }
    const anchor = block(selected, editor);
    description.textContent = `Imagen seleccionada: ${selected.alt}`;
    before.disabled = !embedded(selected, anchor) && !neighbor(anchor, "before");
    after.disabled = !embedded(selected, anchor) && !neighbor(anchor, "after");
    place.disabled = !destination || !editor.contains(destination.startContainer);
  }
  function select(image) {
    editor.querySelectorAll(".editor-image-selected").forEach((node) => node.classList.remove("editor-image-selected"));
    image.classList.add("editor-image-selected");
    destination = null;
    status.textContent = "";
    refresh();
  }
  function removeEmpty(anchor, image) {
    if (anchor !== image && !anchor.contains(image) && !anchor.textContent.trim() && !anchor.querySelector("img")) anchor.remove();
  }
  function move(direction) {
    if (!selected || !editor.contains(selected)) return;
    try {
      const active = document.activeElement;
      const draft = editor.cloneNode(true);
      const image = draft.querySelector("img.editor-image-selected");
      const anchor = block(image, draft);
      if (direction === "cursor") {
        if (!destination || !editor.contains(destination.startContainer)) throw new Error("Coloca primero el cursor en el lugar del texto donde quieras la imagen.");
        const path = [];
        let container = destination.startContainer;
        while (container !== editor) {
          path.unshift([...container.parentNode.childNodes].indexOf(container));
          container = container.parentNode;
        }
        const target = path.reduce((node, index) => node.childNodes[index], draft);
        const range = document.createRange();
        range.setStart(target, destination.startOffset);
        range.collapse(true);
        range.insertNode(image);
      } else {
        const adjacent = neighbor(anchor, direction);
        if (!embedded(image, anchor) && !adjacent) throw new Error("La imagen ya está en ese extremo del texto.");
        const reference = embedded(image, anchor) ? anchor : adjacent;
        draft.insertBefore(image, direction === "before" ? reference : reference.nextSibling);
      }
      removeEmpty(anchor, image);
      const index = [...draft.querySelectorAll("img")].indexOf(image);
      editor.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      // One native edit preserves the editor's undo/redo history.
      if (!document.execCommand("insertHTML", false, draft.innerHTML)) throw new Error("Este navegador no pudo mover la imagen. El texto no se modificó.");
      select(editor.querySelectorAll("img")[index]);
      onChanged();
      status.textContent = "Imagen movida. Revisa su posición y guarda el texto para publicarla.";
      if (controls.contains(active) && !active.disabled) active.focus({ preventScroll: true });
      else selected.focus({ preventScroll: true });
    } catch (error) {
      status.textContent = `No se movió la imagen. ${error.message}`;
    }
  }
  editor.addEventListener("click", (event) => {
    if (event.target.tagName !== "IMG") return;
    event.preventDefault();
    select(event.target);
  });
  editor.addEventListener("keydown", (event) => {
    if (event.target.tagName !== "IMG" || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    select(event.target);
    (before.disabled ? after.disabled ? place : after : before).focus();
  });
  editor.addEventListener("input", refresh);
  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    if (!selected || !selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode) || selected.contains(selection.anchorNode)) return;
    destination = selection.getRangeAt(0).cloneRange();
    refresh();
  });
  before.addEventListener("click", () => move("before"));
  after.addEventListener("click", () => move("after"));
  place.addEventListener("click", () => move("cursor"));
  return {
    refresh,
    select,
    clear() {
      editor.querySelectorAll(".editor-image-selected").forEach((node) => node.classList.remove("editor-image-selected"));
      destination = null;
      status.textContent = "";
      refresh();
    },
  };
}
