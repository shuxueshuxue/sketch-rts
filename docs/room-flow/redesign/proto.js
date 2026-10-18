// The setup-screen redesign prototypes: what each layout does, on the game's real maps. Not game code: a page to look at
// and click, opened straight from its folder (no server). ?mode=solo|online, ?role=host|guest (online), ?map=<id> picks
// the opening map; the bar on top switches them.
(() => {
const params = new URLSearchParams(location.search);
const mode = params.get("mode") === "online" ? "online" : "solo";
const role = mode === "online" && params.get("role") === "guest" ? "guest" : "host";
const canChooseMap = role === "host";

// Art Lane's maps.json, as maps.js carries it: one entry per pool map.
function loadMaps() {
  return window.PROTO_MAPS.map(map => ({
    id: map.id,
    name: map.name?.zh ?? map.zh?.name ?? map.id,
    players: map.players ?? map.seats,
    size: map.facts?.size ?? 0,
    idea: map.ideaZh ?? "",
    facts: map.facts ?? {},
  }));
}

const RACES = ["林地", "余烬", "随机"], STYLES = ["随机", "弓手流", "召唤流", "骑士流"];
// The seats of a map, as the game opens them: you, then computers; online, the second seat is open to a friend, and a
// guest's view has the host in seat 1 and the guest in seat 2.
function seatsFor(players, previous = []) {
  return Array.from({ length: players }, (_, index) => previous[index] ?? defaultSeat(index));
}
function defaultSeat(index) {
  // The kit marks the viewer's own row (.is-you); names are the players' own.
  if (index === 0) return { key: "s1", name: role === "guest" ? "Alice（房主）" : mode === "online" ? "Alice（房主）" : "Alice", controller: "human", team: "各自为战", race: "林地", ready: true, mine: role !== "guest" };
  if (index === 1 && mode === "online") return role === "guest"
    ? { key: "s2", name: "Bob", controller: "human", team: "各自为战", race: "余烬", ready: false, mine: true }
    : { key: "s2", name: "空位", controller: "open", team: "各自为战", race: "随机", ready: false };
  return { key: `s${index + 1}`, name: `电脑 ${index}`, controller: "ai", team: "各自为战", race: "随机", style: "随机", ready: true };
}

// Seat rows by key: a row stays the same element across renders (and the list where it is scrolled to).
function renderSeats(table, seats) {
  const rows = new Map([...table.querySelectorAll(".seat-row")].map(row => [row.dataset.key, row]));
  for (const row of rows.values()) if (!seats.some(seat => seat.key === row.dataset.key)) row.remove();
  seats.forEach((seat, index) => {
    const row = rows.get(seat.key) ?? Object.assign(document.createElement("div"), { className: "seat-row" });
    row.dataset.key = seat.key;
    const editable = seat.mine || (role === "host" && seat.controller !== "human");
    row.className = `seat-row${seat.mine ? " is-you" : ""}${seat.controller === "open" ? " is-open" : ""}${editable ? "" : " is-locked"}`;
    const select = (cls, options, value) => `<select class="${cls}" ${editable ? "" : "disabled"}>${options.map(o => `<option ${o === value ? "selected" : ""}>${o}</option>`).join("")}</select>`;
    row.innerHTML = `<span class="seat-index">${index + 1}</span><span class="seat-name">${seat.name}</span>`
      + (role === "host" && seat.controller !== "human" ? select("seat-ctrl", ["电脑", "开放"], seat.controller === "ai" ? "电脑" : "开放") : `<span class="seat-ctrl seat-badge">${seat.controller === "human" ? "玩家" : seat.controller === "ai" ? "电脑" : "开放"}</span>`)
      + select("seat-team", ["各自为战", "队伍 1", "队伍 2"], seat.team) + select("seat-race", RACES, seat.race)
      + (seat.controller === "ai" ? select("seat-ai", STYLES, seat.style) : `<span class="seat-ai"></span>`)
      + (mode === "online" ? `<label class="seat-ready"><input type="checkbox" ${seat.ready ? "checked" : ""} ${seat.mine && seat.controller === "human" ? "" : "disabled"}> 准备</label>` : "");
    table.appendChild(row);
  });
}

function seatHead(table) {
  const head = document.createElement("div");
  head.className = "seat-head";
  head.innerHTML = `<span></span><span>玩家</span><span>控制</span><span>队伍</span><span>种族</span><span>电脑</span>${mode === "online" ? "<span>准备</span>" : ""}`;
  table.prepend(head);
}

const title = mode === "solo" ? "单人游戏" : "房间设置";
const status = mode === "solo" ? "" : role === "host" ? "Alice 的房间 · 等待 1 名玩家加入" : "Alice 的房间 · 房主选图，你选自己的座位";
function footer(el, extra = "") {
  el.innerHTML = mode === "solo"
    ? `${extra}<button class="btn btn-primary">开始比赛</button><button class="btn btn-quiet">返回</button>`
    : role === "host"
      ? `${extra}<span class="rs-reason">还有空位在等人：换成电脑，或者关掉。</span><button class="btn">复制邀请链接</button><button class="btn btn-danger">关闭房间</button><button class="btn btn-primary" disabled>开始比赛</button><button class="btn btn-quiet">返回房间列表</button>`
      : `${extra}<span class="rs-reason">等房主开始</span><button class="btn">复制邀请链接</button><button class="btn btn-quiet">离开房间</button>`;
}
const meta = map => `${map.players} 人 · ${map.size ? `${map.size}²` : ""}${map.idea ? ` · ${map.idea}` : ""}`;

// The bar above the window: the three options, and who is looking (solo, host, guest). Links keep the other choices.
function switcher(option) {
  const bar = document.createElement("nav");
  bar.className = "proto-switcher";
  const query = (changes) => { const next = new URLSearchParams(location.search); for (const [key, value] of Object.entries(changes)) value === undefined ? next.delete(key) : next.set(key, value); next.delete("step"); return `?${next}`; };
  const link = (href, label, current) => `<a href="${href}"${current ? ' aria-current="page"' : ""}>${label}</a>`;
  bar.innerHTML = ["a", "b", "c"].map(o => link(`option-${o}.html${query({})}`, `方案 ${o.toUpperCase()}`, o === option)).join("")
    + "<span></span>"
    + link(query({ mode: "solo", role: undefined }), "单人", mode === "solo")
    + link(query({ mode: "online", role: "host" }), "联机 · 房主", mode === "online" && role === "host")
    + link(query({ mode: "online", role: "guest" }), "联机 · 客人", mode === "online" && role === "guest");
  if (params.has("bare")) document.body.classList.add("bare"); else document.body.prepend(bar);
}

window.Proto = { mode, role, canChooseMap, loadMaps, seatsFor, renderSeats, seatHead, title, status, footer, meta, switcher };
})();
