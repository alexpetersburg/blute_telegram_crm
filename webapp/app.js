"use strict";

const tg = window.Telegram && window.Telegram.WebApp;
// KeyboardButton launches have empty initData. The SDK's platform is "unknown"
// in a regular browser; use it only for UI availability, not authentication.
const inTelegram = Boolean(tg && tg.platform && tg.platform !== "unknown" && typeof tg.sendData === "function");
const STORAGE_KEY = `blute:draft:${SHEET_ID}:${SHEET_NAME}:${tg?.initDataUnsafe?.user?.id || "browser"}`;
const FAVORITES_KEY = `${STORAGE_KEY}:favorites`;
const state = { items: [], qty: Object.create(null), favorites: new Set(), query: "", filter: "all", sort: "default", loading: false, sending: false };
const $ = id => document.getElementById(id);
const money = n => `${Number(n).toLocaleString("ru-RU")} ₽`;
const normalize = value => String(value).toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim();
let notificationTimer;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function notify(message) {
  $("notification").textContent = message;
  $("notification").hidden = false;
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => { $("notification").hidden = true; }, 4000);
}

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}

function saveDraft() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.qty));
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
    $("draft-note").textContent = "Черновик сохраняется на этом устройстве";
  } catch {
    $("draft-note").textContent = "Хранилище недоступно. Черновик сохранится только до закрытия страницы.";
  }
}

function parseItems(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => normalize(h));
  const index = name => header.indexOf(name);
  if (["id", "name", "price"].some(name => index(name) < 0)) throw new Error("В прайсе отсутствуют колонки id, name или price.");
  const seen = new Set();
  const items = [];
  for (const row of rows.slice(1)) {
    const id = String(row[index("id")] ?? "").trim();
    const name = String(row[index("name")] ?? "").trim();
    const priceRaw = String(row[index("price")] ?? "").replace(/[\s\u00a0₽]/g, "").replace(",", ".");
    const price = Number(priceRaw);
    const enabled = String(row[index("enabled")] ?? "TRUE").trim().toUpperCase();
    const sort = Number(row[index("sort")] ?? 0);
    if (!id || !name || !priceRaw || !Number.isFinite(price) || price < 0 || seen.has(id)) continue;
    if (!["TRUE", "1", "YES"].includes(enabled)) continue;
    seen.add(id);
    items.push({ id, name, price: Math.round(price), sort: Number.isFinite(sort) ? sort : 0 });
  }
  return items.sort((a, b) => a.sort - b.sort);
}

async function loadItems() {
  if (state.loading) return;
  state.loading = true;
  $("refresh").disabled = true;
  $("retry").hidden = true;
  $("grid").setAttribute("aria-busy", "true");
  if (!state.items.length) $("catalog-status").textContent = "Загружаем товары из прайса…";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(RANGE)}?key=${API_KEY}`;
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось получить прайс. Проверьте доступ к таблице и подключение к сети.");
    const data = await response.json();
    const items = parseItems(data.values || []);
    let removed = false;
    let changedPrice = false;
    for (const old of state.items) {
      const next = items.find(item => item.id === old.id);
      if (state.qty[old.id] && next && old.price !== next.price) changedPrice = true;
    }
    const validIds = new Set(items.map(item => item.id));
    for (const id of Object.keys(state.qty)) {
      if (!validIds.has(id)) { if (state.qty[id]) removed = true; delete state.qty[id]; }
    }
    state.items = items;
    saveDraft();
    render();
    if (removed || changedPrice) notify("Прайс обновлён: состав или цены заказа изменились. Проверьте итог.");
  } catch (error) {
    const message = error.name === "AbortError" ? "Прайс долго не отвечает. Попробуйте загрузить его снова." : error.message;
    if (state.items.length) notify(`${message} Показан предыдущий прайс.`);
    else {
      $("catalog-status").textContent = message;
      $("catalog-status").hidden = false;
      $("result-count").textContent = "Прайс недоступен";
    }
    $("retry").hidden = false;
  } finally {
    clearTimeout(timeout);
    state.loading = false;
    $("refresh").disabled = false;
    $("grid").setAttribute("aria-busy", "false");
    renderCart();
  }
}

function visibleItems() {
  const words = normalize(state.query).split(/\s+/).filter(Boolean);
  const items = state.items.filter(item => {
    const haystack = normalize(`${item.name} ${item.id}`);
    return words.every(word => haystack.includes(word)) &&
      (state.filter !== "favorites" || state.favorites.has(item.id)) &&
      (state.filter !== "cart" || state.qty[item.id] > 0);
  });
  if (state.sort === "name") items.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  if (state.sort === "price-asc") items.sort((a, b) => a.price - b.price);
  if (state.sort === "price-desc") items.sort((a, b) => b.price - a.price);
  return items;
}

function actionButton(label, action, item, className) {
  const button = node("button", className, label);
  button.type = "button";
  button.dataset.id = item.id;
  button.dataset.action = action;
  return button;
}

function stepper(item) {
  const container = node("div", "stepper");
  const minus = actionButton("−", "minus", item);
  minus.disabled = !(state.qty[item.id] > 0);
  minus.setAttribute("aria-label", `Уменьшить количество: ${item.name}`);
  const input = node("input");
  input.type = "number"; input.min = "0"; input.max = "999"; input.step = "1"; input.inputMode = "numeric";
  input.value = state.qty[item.id] || 0;
  input.dataset.id = item.id;
  input.setAttribute("aria-label", `Количество: ${item.name}`);
  const plus = actionButton("+", "plus", item, "plus");
  plus.disabled = state.qty[item.id] >= 999;
  plus.setAttribute("aria-label", `Увеличить количество: ${item.name}`);
  container.append(minus, input, plus);
  return container;
}

function renderGrid() {
  const items = visibleItems();
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = node("article", `product${state.qty[item.id] ? " selected" : ""}`);
    const top = node("div", "product-top");
    const favorite = actionButton(state.favorites.has(item.id) ? "★" : "☆", "favorite", item, `favorite${state.favorites.has(item.id) ? " chosen" : ""}`);
    favorite.setAttribute("aria-label", `Избранное: ${item.name}`);
    favorite.setAttribute("aria-pressed", String(state.favorites.has(item.id)));
    top.append(node("span", "product-id", `ID ${item.id}`), favorite);
    card.append(top, node("h3", "", item.name), node("div", "product-price", money(item.price)), stepper(item));
    fragment.append(card);
  }
  $("grid").replaceChildren(fragment);
  $("result-count").textContent = `Показано ${items.length} из ${state.items.length}`;
  $("catalog-status").hidden = items.length > 0;
  $("catalog-status").textContent = !state.items.length ? "В прайсе пока нет доступных товаров." : state.query ? "Ничего не найдено. Попробуйте другое название или ID." : state.filter === "favorites" ? "Добавьте частые товары в избранное кнопкой ☆." : "В заказе пока нет товаров. Добавьте их из каталога.";
  $("reset-search").hidden = !state.query;
}

function cartItems() {
  return state.items.filter(item => state.qty[item.id] > 0).map(item => ({ id: item.id, name: item.name, price: item.price, qty: state.qty[item.id] }));
}

function calcTotal() { return cartItems().reduce((sum, item) => sum + item.price * item.qty, 0); }

function renderCart() {
  const items = cartItems();
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const line = node("div", "cart-line");
    const heading = node("div", "cart-line-heading");
    heading.append(node("span", "", item.name), node("strong", "", money(item.price * item.qty)));
    const controls = node("div", "cart-controls");
    const remove = actionButton("Удалить", "remove", item, "remove");
    remove.setAttribute("aria-label", `Удалить из заказа: ${item.name}`);
    controls.append(stepper(item), remove);
    line.append(heading, node("div", "cart-line-meta", `${item.qty} × ${money(item.price)}`), controls);
    fragment.append(line);
  }
  if (!items.length) fragment.append(node("div", "empty", "Здесь появится ваш букет. Добавьте товары кнопкой + в каталоге."));
  $("cart").replaceChildren(fragment);
  $("total").textContent = money(calcTotal());
  const count = `${items.reduce((sum, item) => sum + item.qty, 0)} шт.`;
  $("item-count").textContent = count;
  $("mobile-count").textContent = count;
  $("mobile-total").textContent = money(calcTotal());
  $("cart-filter-count").textContent = items.length;
  $("clear").disabled = !items.length || state.sending;
  $("send").disabled = !items.length || calcTotal() <= 0 || state.loading || state.sending;
}

function render() { renderGrid(); renderCart(); }

function setQty(id, value) {
  if (!state.items.some(item => item.id === id)) return;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0 || number > 999) {
    notify("Введите целое количество от 0 до 999."); render(); return;
  }
  if (number) state.qty[id] = number; else delete state.qty[id];
  saveDraft(); render();
}

function reviewOrder() {
  const fragment = document.createDocumentFragment();
  for (const item of cartItems()) {
    const line = node("div", "review-line");
    line.append(node("span", "", `${item.name} · ${item.qty} × ${money(item.price)}`), node("span", "", money(item.qty * item.price)));
    fragment.append(line);
  }
  $("review-items").replaceChildren(fragment);
  $("review-total").textContent = money(calcTotal());
  $("send-error").textContent = "";
  $("confirm-send").disabled = !inTelegram;
  if (!inTelegram) $("send-error").textContent = "Для отправки откройте кассу кнопкой в Telegram-боте. Здесь можно собрать и сохранить черновик.";
  $("review").showModal();
}

function sendOrder() {
  if (state.sending || !inTelegram || !cartItems().length || calcTotal() <= 0) return;
  const payload = JSON.stringify({ v: 1, createdAt: new Date().toISOString(), currency: "RUB", items: cartItems(), total: calcTotal() });
  if (new TextEncoder().encode(payload).length > 4096) {
    $("send-error").textContent = "Заказ слишком большой для Telegram. Разделите его на несколько заказов."; return;
  }
  try {
    state.sending = true;
    $("confirm-send").disabled = true;
    tg.sendData(payload);
    // sendData closes the Mini App; delivery is confirmed by the bot, not by the client.
    // Keep the draft until the user explicitly clears it, including if delivery fails.
  } catch {
    state.sending = false;
    $("confirm-send").disabled = false;
    $("send-error").textContent = "Не удалось отправить заказ. Черновик сохранён, попробуйте снова.";
  }
}

function bindEvents() {
  $("search").addEventListener("input", event => { state.query = event.target.value; renderGrid(); });
  $("reset-search").addEventListener("click", () => { state.query = ""; $("search").value = ""; renderGrid(); $("search").focus(); });
  $("sort").addEventListener("change", event => { state.sort = event.target.value; renderGrid(); });
  document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(chip => { chip.classList.toggle("active", chip === button); chip.setAttribute("aria-pressed", String(chip === button)); });
    renderGrid();
  }));
  for (const container of [$("grid"), $("cart")]) {
    container.addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const { id, action } = button.dataset;
      if (action === "favorite") {
        if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
        saveDraft(); renderGrid();
      } else setQty(id, action === "remove" ? 0 : (state.qty[id] || 0) + (action === "plus" ? 1 : -1));
    });
    container.addEventListener("change", event => { if (event.target.matches("input[data-id]")) setQty(event.target.dataset.id, event.target.value); });
  }
  $("clear").addEventListener("click", () => {
    if (!window.confirm("Очистить текущий заказ?")) return;
    state.qty = Object.create(null); saveDraft(); render(); notify("Заказ очищен");
  });
  $("refresh").addEventListener("click", loadItems);
  $("retry").addEventListener("click", loadItems);
  $("send").addEventListener("click", reviewOrder);
  $("confirm-send").addEventListener("click", sendOrder);
}

const saved = readStorage(STORAGE_KEY, {});
if (saved && typeof saved === "object" && !Array.isArray(saved)) {
  for (const [id, qty] of Object.entries(saved)) if (Number.isInteger(qty) && qty > 0 && qty <= 999) state.qty[id] = qty;
}
const favorites = readStorage(FAVORITES_KEY, []);
if (Array.isArray(favorites)) state.favorites = new Set(favorites.filter(id => typeof id === "string"));
if (tg) { tg.ready(); if (inTelegram) tg.expand(); }
$("telegram-hint").textContent = inTelegram ? "Проверьте состав перед отправкой в рабочий чат." : "Отправка доступна при открытии из Telegram-бота.";
bindEvents();
renderCart();
loadItems();
