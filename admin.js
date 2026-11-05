(function () {
  "use strict";
  var C = window.LB_CONFIG, $ = function (s) { return document.querySelector(s); };
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  var role = null, users = [], timer = null, tab = "overview";

  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  function fmt(d) { return d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never"; }
  function ago(d) {
    if (!d) return "never"; var s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
    if (s < 90) return Math.round(s) + "s ago"; if (s < 5400) return Math.round(s / 60) + " min ago";
    if (s < 129600) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " days ago";
  }
  function money(n) { return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(n) { return (Number(n || 0) * 100).toFixed(1) + "%"; }
  function say(t, bad) { var m = $("#msg"); m.textContent = t || ""; m.className = bad ? "bad-t" : ""; }
  function tile(n, label) { var t = el("div", null, "tile"); t.appendChild(el("b", String(n))); t.appendChild(el("span", label)); return t; }
  function clear(sel) { var n = $(sel); n.textContent = ""; return n; }
  function row(tb, cells) { var tr = el("tr"); cells.forEach(function (v) { tr.appendChild(el("td", v == null ? "" : String(v))); }); tb.appendChild(tr); return tr; }
  function btn(label, cls, fn) { var b = el("button", label, cls || ""); b.type = "button"; b.onclick = fn; return b; }
  function isOn(x) { return x.active && (!x.expires_at || new Date(x.expires_at) > new Date()); }

  /* ---------- actions (every one is confirmed and logged server-side) ---------- */
  async function setAccess(u, edition, active) {
    var verb = active ? "Give " + edition + " access to " : "Turn off cloud access for ";
    if (!confirm(verb + u.email + "?")) return;
    var r = await sb.rpc("admin_set_access", { p_user: u.user_id, p_edition: edition, p_active: active });
    if (r.error) return say("Could not change access.", true);
    say("Updated " + u.email + "."); loadAccounts();
  }
  async function suspend(u, on) {
    if (!confirm((on ? "Suspend sign-in for " : "Restore sign-in for ") + u.email + "?")) return;
    var r = await sb.rpc("admin_set_suspended", { p_user: u.user_id, p_suspend: on });
    if (r.error) return say("Could not do that: " + r.error.message, true);
    say((on ? "Suspended " : "Restored ") + u.email + "."); loadAccounts();
  }
  async function exportUser(u) {
    var r = await sb.rpc("admin_export_user", { p_user: u.user_id });
    if (r.error) return say("Could not export.", true);
    var blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "account-" + u.email.replace(/[^a-z0-9]+/gi, "_") + ".json";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  async function delUser(u) {
    var t = prompt("This permanently deletes " + u.email + " and all of its data. Type the email to confirm:");
    if (t == null) return;
    var r = await sb.rpc("admin_delete_user", { p_user: u.user_id, p_confirm_email: t.trim() });
    if (r.error) return say("Not deleted: " + r.error.message, true);
    say("Deleted " + u.email + "."); loadAccounts();
  }

  /* ---------- overview ---------- */
  async function loadOverview() {
    var m = await sb.rpc("admin_metrics");
    if (m.error) return say("Could not load metrics.", true);
    var d = m.data, t = clear("#revTiles");
    [[money(d.mrr), "Monthly recurring revenue"], [money(d.arr), "Annualised (x12)"], [d.paying, "Paying accounts"], [d.paying_pro, "Of those Pro"],
     [d.users_total, "All accounts"], [d.users_today, "New today"], [d.users_7d, "New (7 days)"], [d.users_30d, "New (30 days)"],
     [d.confirmed, "Confirmed email"], [d.unconfirmed, "Unconfirmed"], [pct(d.conversion_confirmed_to_paid), "Confirmed to paid"], [d.manual_grants, "Manual grants (not revenue)"]]
      .forEach(function (x) { t.appendChild(tile(x[0], x[1])); });

    var fb = $("#funnel tbody"); fb.textContent = "";
    [["Signed up", d.funnel.signed_up], ["Confirmed email", d.funnel.confirmed], ["Opened a ledger", d.funnel.opened_ledger],
     ["Added items", d.funnel.added_items], ["Paying", d.funnel.paid]].forEach(function (x) {
      row(fb, [x[0], x[1], d.funnel.signed_up ? pct(x[1] / d.funnel.signed_up) : "-"]);
    });

    var p = d.projection_30d, box = clear("#proj");
    box.appendChild(el("p", "Next 30 days if the last 30 days repeat: about " + p.new_signups + " new accounts at today's " + pct(d.conversion_confirmed_to_paid) + " confirmed-to-paid rate."));
    var tb = el("table"); var th = el("thead"), thr = el("tr");
    ["", "Low (half the rate)", "Expected", "High (1.5x the rate)"].forEach(function (h) { thr.appendChild(el("th", h)); }); th.appendChild(thr); tb.appendChild(th);
    var body = el("tbody");
    row(body, ["New paying accounts", p.new_paying_low, p.new_paying_mid, p.new_paying_high]);
    row(body, ["Added monthly revenue (at " + money(d.price) + ")", money(p.added_mrr_low), money(p.added_mrr_mid), money(p.added_mrr_high)]);
    row(body, ["Monthly revenue after 30 days", money(d.mrr + p.added_mrr_low), money(d.mrr + p.added_mrr_mid), money(d.mrr + p.added_mrr_high)]);
    tb.appendChild(body); box.appendChild(tb);
    box.appendChild(el("p", p.enough_data ? "Basis: " + p.basis + "." : "Early numbers: fewer than 30 confirmed accounts or 3 paying accounts, so treat this as a rough guide only. Basis: " + p.basis + ".", "mute"));

    var cb = $("#cohorts tbody"); cb.textContent = "";
    (d.weekly_cohorts || []).forEach(function (c) { row(cb, [c.week, c.signups, c.paid, c.active_7d]); });

    var s = await sb.rpc("admin_stats");
    if (s.error) return;
    var u = s.data, ut = clear("#tiles");
    [[u.active_users_7d, "Active users (7d)"], [u.opens_7d, "Ledger opens (7d)"], [u.items_total, "Items stored"], [u.log_total, "History entries"]]
      .forEach(function (x) { ut.appendChild(tile(x[0], x[1])); });
    var bars = clear("#bars");
    var max = Math.max.apply(null, u.signups_by_day.map(function (x) { return x.n; }).concat([1]));
    u.signups_by_day.forEach(function (x) { var b = el("div"); b.style.height = Math.max(2, (x.n / max) * 100) + "%"; b.title = x.day + ": " + x.n; bars.appendChild(b); });
    var bl = $("#byLedger tbody"); bl.textContent = "";
    u.by_ledger.forEach(function (x) { row(bl, [x.ledger, x.accounts, x.items]); });
  }

  /* ---------- accounts ---------- */
  async function loadAccounts() {
    var u = await sb.rpc("admin_users");
    if (u.error) return say("Could not load accounts.", true);
    users = u.data; drawAccounts();
  }
  function drawAccounts() {
    var q = $("#q").value.trim().toLowerCase(), f = $("#flt").value, tb = clear("#users tbody"), n = 0;
    users.forEach(function (x) {
      var on = isOn(x);
      if (q && x.email.toLowerCase().indexOf(q) < 0) return;
      if (f === "paid" && !(on && x.source === "gumroad")) return;
      if (f === "free" && on) return;
      if (f === "unconf" && x.confirmed) return;
      if (f === "idle" && Number(x.opens_30d) > 0) return;
      n++;
      var tr = el("tr");
      tr.appendChild(el("td", x.email)); tr.appendChild(el("td", fmt(x.created_at))); tr.appendChild(el("td", fmt(x.last_sign_in_at)));
      tr.appendChild(el("td", x.confirmed ? "yes" : "no"));
      var td = el("td"); td.appendChild(el("span", on ? x.edition : "none", "pill " + (on ? "on" : "off"))); tr.appendChild(td);
      tr.appendChild(el("td", x.source || "-")); tr.appendChild(el("td", String(x.rows_total))); tr.appendChild(el("td", String(x.opens_30d)));
      var act = el("td");
      act.appendChild(btn("Standard", "go", function () { setAccess(x, "standard", true); })); act.appendChild(document.createTextNode(" "));
      act.appendChild(btn("Pro", "go", function () { setAccess(x, "pro", true); })); act.appendChild(document.createTextNode(" "));
      if (on) { act.appendChild(btn("Turn off", "bad", function () { setAccess(x, x.edition || "standard", false); })); act.appendChild(document.createTextNode(" ")); }
      act.appendChild(btn("Suspend", "bad", function () { suspend(x, true); })); act.appendChild(document.createTextNode(" "));
      act.appendChild(btn("Restore", "", function () { suspend(x, false); })); act.appendChild(document.createTextNode(" "));
      act.appendChild(btn("Export", "", function () { exportUser(x); }));
      if (role === "owner") { act.appendChild(document.createTextNode(" ")); act.appendChild(btn("Delete", "bad", function () { delUser(x); })); }
      tr.appendChild(act); tb.appendChild(tr);
    });
    $("#cnt").textContent = n + " of " + users.length;
  }

  /* ---------- live health ---------- */
  async function loadHealth() {
    var r = await sb.rpc("admin_health");
    var tiles = clear("#hTiles"), al = clear("#alerts");
    if (r.error) { al.appendChild(el("div", "Database did not answer. Check Supabase status.", "alert")); return; }
    var h = r.data, flags = [];
    if (h.unconfirmed_older_1d > 0) flags.push(h.unconfirmed_older_1d + " accounts never confirmed their email (check the confirmation email is arriving).");
    if (h.signups_last_hour >= 20) flags.push(h.signups_last_hour + " signups in the last hour: unusual burst, check for abuse.");
    if (h.db_size_mb > 400) flags.push("Database is " + h.db_size_mb + " MB; the free plan limit is 500 MB.");
    if (h.pending_purchases > 0) flags.push(h.pending_purchases + " purchase(s) waiting for the buyer to create an account.");
    if (h.banned_accounts > 0) flags.push(h.banned_accounts + " suspended account(s).");
    if (!flags.length) al.appendChild(el("div", "All clear: database answering, no alerts.", "okay"));
    flags.forEach(function (f) { al.appendChild(el("div", f, "alert")); });
    [["OK", "Database"], [h.active_users_15min, "Active now (15 min)"], [h.events_last_5min, "Events (5 min)"], [h.events_last_hour, "Events (1 hour)"],
     [ago(h.last_signup), "Last signup"], [ago(h.last_sign_in), "Last sign-in"], [ago(h.last_event), "Last activity"], [ago(h.last_gumroad_grant), "Last Gumroad grant"],
     [h.db_size_mb + " MB", "Database size"], [h.ledger_rows, "Ledger rows"], [h.signups_last_hour, "Signups (1 hour)"], [h.pending_purchases, "Purchases waiting for account"]]
      .forEach(function (x) { tiles.appendChild(tile(x[0], x[1])); });
    $("#hts").textContent = "updated " + new Date().toLocaleTimeString() + ", refreshes every 30 seconds";
  }

  /* ---------- recovery emails ---------- */
  async function loadRecovery() {
    var box = clear("#recInfo");
    box.appendChild(el("p", "Who is included: confirmed accounts that have not bought, did not unsubscribe, signed up more than 24 hours ago, and are not admins. At most 2 emails each, 3 days apart."));
    box.appendChild(el("p", "Each email has the business postal address and a one-click unsubscribe. Sending needs the owner role and is not switched on yet: the sender (Resend) and the send function still have to be connected. Until then this list shows exactly who would be emailed.", "mute"));
    var r = await sb.rpc("admin_recovery_audience"), tb = $("#aud tbody"); tb.textContent = "";
    if (r.error) { tb.appendChild(el("tr")).appendChild(el("td", role === "owner" ? "Could not load." : "Owner role required.")); return; }
    if (!r.data.length) row(tb, ["Nobody right now.", "", "", ""]);
    r.data.forEach(function (x) { row(tb, [x.email, fmt(x.created_at), x.opens, "Email " + x.next_step]); });
  }

  /* ---------- admins and audit ---------- */
  async function loadTeam() {
    var a = await sb.rpc("admin_list_admins"), tb = clear("#adm tbody");
    $("#admAdd").hidden = role !== "owner";
    if (!a.error) a.data.forEach(function (x) {
      var tr = row(tb, [x.email, x.role, ""]), td = tr.lastChild;
      if (role === "owner") td.appendChild(btn("Remove", "bad", async function () {
        if (!confirm("Remove admin access for " + x.email + "?")) return;
        var r = await sb.rpc("admin_remove_admin", { p_email: x.email });
        if (r.error) return say("Could not remove: " + r.error.message, true); say("Removed."); loadTeam();
      }));
    });
    var l = await sb.rpc("admin_audit_list", { p_limit: 100 }), ab = clear("#audit tbody");
    if (!l.error) l.data.forEach(function (x) { row(ab, [fmt(x.at), x.actor_email, x.action, x.target, x.detail ? JSON.stringify(x.detail) : ""]); });
  }

  /* ---------- plumbing ---------- */
  function show(name) {
    tab = name;
    ["overview", "accounts", "health", "recovery", "team"].forEach(function (t) { $("#t-" + t).hidden = t !== name; });
    document.querySelectorAll("#tabs button").forEach(function (b) { b.className = b.getAttribute("data-tab") === name ? "go" : ""; });
    clearInterval(timer); timer = null;
    if (name === "overview") loadOverview(); if (name === "accounts") loadAccounts(); if (name === "recovery") loadRecovery(); if (name === "team") loadTeam();
    if (name === "health") { loadHealth(); timer = setInterval(loadHealth, 30000); }
  }
  async function start() {
    var w = await sb.rpc("admin_whoami");
    if (w.error) { $("#main").hidden = true; $("#denied").hidden = false; return; }
    role = w.data; $("#denied").hidden = true; $("#main").hidden = false;
    $("#me").textContent = $("#me").textContent + " (" + role + ")";
    show("overview");
  }
  document.querySelectorAll("#tabs button").forEach(function (b) { b.onclick = function () { show(b.getAttribute("data-tab")); }; });
  $("#refresh").onclick = function () { show(tab); };
  $("#q").oninput = drawAccounts; $("#flt").onchange = drawAccounts;
  $("#admGo").onclick = async function () {
    var e = $("#admEmail").value.trim(); if (!e) return;
    if (!confirm("Make " + e + " " + $("#admRole").value + "?")) return;
    var r = await sb.rpc("admin_set_admin", { p_email: e, p_role: $("#admRole").value });
    if (r.error) return say("Could not add: " + r.error.message, true);
    $("#admEmail").value = ""; say("Saved."); loadTeam();
  };
  sb.auth.getSession().then(function (r) {
    if (!r.data.session) { location.replace("./"); return; }
    $("#me").textContent = r.data.session.user.email;
    start();
  });
})();
