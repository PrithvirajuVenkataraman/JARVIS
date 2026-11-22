/** Preserve completed message nodes (selection, focus, and controls) while streaming. */
/** @param {HTMLElement} element @param {string} html @param {boolean} streaming */
export function updateMessageHtml(element, html, streaming = false) {
    if (!streaming) { element.innerHTML = html; return; }
    const template = element.ownerDocument.createElement('template');
    template.innerHTML = html;
    const incoming = Array.from(template.content.childNodes);
    const existing = Array.from(element.childNodes);
    let stable = 0;
    while (stable < Math.min(existing.length, incoming.length) && existing[stable].isEqualNode(incoming[stable])) stable++;
    for (let index = stable; index < existing.length; index++) existing[index].remove();
    const fragment = element.ownerDocument.createDocumentFragment();
    for (let index = stable; index < incoming.length; index++) fragment.append(incoming[index]);
    element.append(fragment);
}
