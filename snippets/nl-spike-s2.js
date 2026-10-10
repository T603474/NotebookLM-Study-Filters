// === Spike S2 (hito 3): DOM de los elementos de estudio, su menu y el dialogo ===
// SOLO LECTURA: no hace ningun clic ni modifica nada; vuelca la estructura de lo
// que haya en pantalla en el momento de ejecutarlo. Se ejecuta TRES veces,
// en DevTools > Console de la pestana de Gemini Notebook (contexto "top"):
//   1) Sin nada abierto.
//   2) Despues de abrir tu MISMO el menu ⋮ de un elemento de estudio.
//   3) Despues de pulsar tu mismo "Eliminar" en ese menu, con el dialogo de
//      confirmacion en pantalla. Pulsa CANCELAR despues de ejecutarlo.
// Cada ejecucion imprime el resultado y lo copia al portapapeles (copy()).
// Los textos de mas de 40 caracteres (titulos, contenido) se sustituyen por su
// longitud; las etiquetas cortas de la interfaz ("Eliminar", "Cancelar") si se
// ven porque son lo que necesito. Revisa la salida antes de pegarla.
(function () {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const KEEP_ATTRS = ['role', 'aria-label', 'aria-haspopup', 'aria-expanded', 'aria-controls', 'type', 'mat-menu-item', 'mattooltip', 'data-testid', 'jslog', 'id', 'tabindex'];

  function clip(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > 40 ? '<' + t.length + ' car.>' : t;
  }

  function attrsOf(el) {
    const out = {};
    Array.from(el.attributes).forEach((a) => {
      const keep = KEEP_ATTRS.includes(a.name) || a.name.startsWith('data-') || UUID.test(a.value);
      if (!keep) return;
      out[a.name] = UUID.test(a.value)
        ? a.value.replace(UUID, (m) => m.slice(0, 8) + '...')
        : clip(a.value);
    });
    return out;
  }

  function classOf(el) {
    const c = el.className;
    return String((c && c.baseVal !== undefined) ? c.baseVal : (c || '')).slice(0, 100);
  }

  // Arbol con tope de profundidad y de nodos para que la salida sea pegable.
  function tree(el, depth, budget) {
    if (!el || budget.n <= 0) return null;
    budget.n -= 1;
    const node = { tag: el.tagName.toLowerCase(), class: classOf(el) };
    const attrs = attrsOf(el);
    if (Object.keys(attrs).length) node.attrs = attrs;
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ');
    if (clip(own)) node.text = clip(own);
    if (depth > 0 && el.children.length) {
      node.children = Array.from(el.children).map((c) => tree(c, depth - 1, budget)).filter(Boolean);
    }
    return node;
  }

  const items = Array.from(document.querySelectorAll('artifact-library-item'));
  const first = items[0];
  const firstButtons = first
    ? Array.from(first.querySelectorAll('button, [role=button], mat-checkbox, input[type=checkbox]')).map((b) => ({
      tag: b.tagName.toLowerCase(), class: classOf(b), attrs: attrsOf(b), text: clip(b.textContent),
    }))
    : [];

  // Superposiciones de Angular Material (menus y dialogos viven aqui, fuera del item).
  const overlayRoots = Array.from(document.querySelectorAll('.cdk-overlay-container, [class*="overlay-container"]'));
  const overlayPanes = overlayRoots.flatMap((root) => Array.from(root.children));
  const overlay = overlayPanes.map((pane) => tree(pane, 7, { n: 120 })).filter(Boolean);
  const dialogs = Array.from(document.querySelectorAll('[role=dialog], [role=alertdialog], mat-dialog-container, [role=menu], .mat-mdc-menu-panel'))
    .map((d) => tree(d, 6, { n: 80 })).filter(Boolean);

  const result = {
    url: location.hostname + location.pathname.replace(/[0-9a-f-]{36}/i, '<notebook-id>'),
    artifactItems: items.length,
    firstItem: first ? tree(first, 5, { n: 80 }) : null,
    firstItemInteractive: firstButtons,
    firstItemParent: first && first.parentElement ? { tag: first.parentElement.tagName.toLowerCase(), class: classOf(first.parentElement), childTags: Array.from(first.parentElement.children).slice(0, 5).map((c) => c.tagName.toLowerCase()) } : null,
    overlayPanes: overlay,
    openDialogsOrMenus: dialogs,
  };
  const text = JSON.stringify(result, null, 1);
  console.log(text);
  if (typeof copy === 'function') copy(text);
  return result;
})();
