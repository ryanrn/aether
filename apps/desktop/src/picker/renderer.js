"use strict";

/**
 * Logica do seletor de tela.
 *
 * Nao tem framework de proposito: sao duas listas e um botao. Trazer React
 * para ca significaria um passo de build so para esta janela, dentro de um
 * app cuja graca e nao ter build nenhum.
 *
 * O `window.picker` vem do preload e expoe exatamente tres coisas — as
 * miniaturas ja chegam prontas, esta janela nunca fala com o desktopCapturer.
 */

const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const confirmButton = document.getElementById("confirm");
const cancelButton = document.getElementById("cancel");
const audioCheckbox = document.getElementById("with-audio");
const tabScreens = document.getElementById("tab-screens");
const tabWindows = document.getElementById("tab-windows");

let sources = [];
let tab = "screens";
let selectedId = null;

function visibleSources() {
  return sources.filter((source) =>
    tab === "screens" ? source.isScreen : !source.isScreen,
  );
}

function select(id) {
  selectedId = id;
  confirmButton.disabled = id === null;
  for (const node of grid.querySelectorAll(".source")) {
    node.setAttribute("aria-pressed", String(node.dataset.id === id));
  }
}

function render() {
  const items = visibleSources();
  grid.replaceChildren();
  empty.hidden = items.length > 0;

  for (const source of items) {
    const card = document.createElement("button");
    card.className = "source";
    card.type = "button";
    card.dataset.id = source.id;
    card.setAttribute("aria-pressed", String(source.id === selectedId));

    const thumb = document.createElement("div");
    thumb.className = "thumb";

    if (source.thumbnail) {
      const img = document.createElement("img");
      img.src = source.thumbnail;
      img.alt = "";
      thumb.append(img);
    } else {
      // Janela minimizada nao rende miniatura; dizer isso e melhor que um vazio.
      const placeholder = document.createElement("span");
      placeholder.className = "empty";
      placeholder.textContent = "sem previa";
      thumb.append(placeholder);
    }

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = source.isScreen ? "tela" : "janela";
    thumb.append(badge);

    const caption = document.createElement("div");
    caption.className = "caption";
    if (source.appIcon) {
      const icon = document.createElement("img");
      icon.src = source.appIcon;
      icon.alt = "";
      caption.append(icon);
    }
    const name = document.createElement("span");
    // textContent, nunca innerHTML: o nome vem de uma janela QUALQUER do
    // sistema, e titulo de janela e texto que outro programa escolheu.
    name.textContent = source.name;
    name.title = source.name;
    caption.append(name);

    card.append(thumb, caption);
    card.addEventListener("click", () => select(source.id));
    // Clique duplo escolhe e confirma — o atalho que todo seletor tem.
    card.addEventListener("dblclick", () => {
      select(source.id);
      confirmChoice();
    });

    grid.append(card);
  }
}

function switchTab(next) {
  tab = next;
  tabScreens.setAttribute("aria-selected", String(next === "screens"));
  tabWindows.setAttribute("aria-selected", String(next === "windows"));
  // A selecao nao atravessa abas: confirmar algo invisivel confunde.
  select(null);
  render();
}

function confirmChoice() {
  if (!selectedId) return;
  window.picker.choose(selectedId, audioCheckbox.checked);
}

tabScreens.addEventListener("click", () => switchTab("screens"));
tabWindows.addEventListener("click", () => switchTab("windows"));
cancelButton.addEventListener("click", () => window.picker.cancel());
confirmButton.addEventListener("click", confirmChoice);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.picker.cancel();
  if (event.key === "Enter" && selectedId) confirmChoice();
});

void window.picker.listSources().then((payload) => {
  sources = payload.sources;
  // Escolha lembrada da vez anterior: em maquinas onde o som do sistema nao
  // abre, ninguem precisa desmarcar isso toda vez.
  audioCheckbox.checked = payload.withAudio;

  const screens = sources.filter((source) => source.isScreen).length;
  document.getElementById("count-screens").textContent = String(screens);
  document.getElementById("count-windows").textContent = String(
    sources.length - screens,
  );

  // Comeca nas telas quando ha alguma; senao ja abre em janelas.
  switchTab(screens > 0 ? "screens" : "windows");

  // Uma tela so: ja vem selecionada, para o caso comum ser um clique.
  const items = visibleSources();
  if (items.length === 1) select(items[0].id);
});
