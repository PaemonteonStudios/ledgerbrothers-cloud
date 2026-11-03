(function () {
  "use strict";
  var C = window.LB_CONFIG, $ = function (s) { return document.querySelector(s); };
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  function fmt(d) { return d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never"; }
  function say(t, bad) { var m = $("#msg"); m.textContent = t || ""; m.className = bad ? "bad-t" : ""; }

  async function setAccess(u, edition, active) {
    var verb = active ? "Give " + edition + " access to " : "Turn off cloud access for ";
    if (!confirm(verb + u.email + "?")) return;
    var r = await sb.rpc("admin_set_access", { p_user: u.user_id, p_edition: edition, p_active: active });
    if (r.error) return say("Could not change access.", true);
    say("Updated " + u.email + ".");
    load();
  }

  function tile(n, label) { var t = el("div", null, "tile"); t.appendChild(el("b", String(n))); t.appendChild(el("span", label)); return t; }

  async function load() {
    say("Loading…");
    var s = await sb.rpc("admin_stats");
    if (s.error) { $("#main").hidden = true; $("#denied").hidden = false; return say(""); }
    $("#denied").hidden = true; $("#main").hidden = false; say("");
    var d = s.data, tiles = $("#tiles"); tiles.textContent = "";
    [[d.users_total, "Accounts"], [d.users_7d, "New (7 days)"], [d.paid_active, "Paid & active"], [d.paid_pro, "Of those Pro"],
     [d.active_users_7d, "Active users (7d)"], [d.opens_7d, "Ledger opens (7d)"], [d.items_total, "Items stored"], [d.log_total, "History entries"]]
      .forEach(function (x) { tiles.appendChild(tile(x[0], x[1])); });

    var bars = $("#bars"); bars.textContent = "";
    var max = Math.max.apply(null, d.signups_by_day.map(function (x) { return x.n; }).concat([1]));
    d.signups_by_day.forEach(function (x) {
      var b = el("div"); b.style.height = Math.max(2, (x.n / max) * 100) + "%"; b.title = x.day + ": " + x.n; bars.appendChild(b);
    });

    var bl = $("#byLedger tbody"); bl.textContent = "";
    d.by_ledger.forEach(function (x) {
      var tr = el("tr"); [x.ledger, x.accounts, x.items].forEach(function (v) { tr.appendChild(el("td", String(v))); }); bl.appendChild(tr);
    });

    var u = await sb.rpc("admin_users");
    if (u.error) return say("Could not load accounts.", true);
    var tb = $("#users tbody"); tb.textContent = "";
    u.data.forEach(function (x) {
      var tr = el("tr");
      tr.appendChild(el("td", x.email));
      tr.appendChild(el("td", fmt(x.created_at)));
      tr.appendChild(el("td", fmt(x.last_sign_in_at)));
      tr.appendChild(el("td", x.confirmed ? "yes" : "no"));
      var td = el("td"), on = x.active && (!x.expires_at || new Date(x.expires_at) > new Date());
      td.appendChild(el("span", on ? x.edition : "none", "pill " + (on ? "on" : "off"))); tr.appendChild(td);
      tr.appendChild(el("td", x.source || "-"));
      tr.appendChild(el("td", String(x.rows_total)));
      tr.appendChild(el("td", String(x.opens_30d)));
      var act = el("td");
      [["Standard", "standard", true, "go"], ["Pro", "pro", true, "go"]].forEach(function (a) {
        var b = el("button", a[0], a[3]); b.type = "button"; b.onclick = function () { setAccess(x, a[1], a[2]); }; act.appendChild(b); act.appendChild(document.createTextNode(" "));
      });
      if (on) { var r = el("button", "Turn off", "bad"); r.type = "button"; r.onclick = function () { setAccess(x, x.edition || "standard", false); }; act.appendChild(r); }
      tr.appendChild(act); tb.appendChild(tr);
    });
  }

  $("#refresh").onclick = load;
  sb.auth.getSession().then(function (r) {
    if (!r.data.session) { location.replace("./"); return; }
    $("#me").textContent = r.data.session.user.email;
    load();
  });
})();
