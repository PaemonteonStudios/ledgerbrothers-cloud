(function () {
  "use strict";
  var C = window.LB_CONFIG, $ = function (s) { return document.querySelector(s); };
  var LEDGERS = [
    ["general-ledger", "General Ledger"], ["bakery-ledger", "Bakery Ledger"], ["cafe-and-bar-ledger", "Cafe and Bar Ledger"],
    ["retail-shop-ledger", "Retail Shop Ledger"], ["salon-ledger", "Salon Ledger"],
    ["rental-equipment-ledger", "Rental Equipment Ledger"], ["workshop-and-parts-ledger", "Workshop and Parts Ledger"]
  ];
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
  });
  var mode = "in", session = null, adapter = null, ent = null;

  function say(t, cls) { var m = $("#msg"); m.textContent = t || ""; m.className = cls || ""; }
  function show(id) { ["#auth", "#home", "#run"].forEach(function (s) { $(s).hidden = s !== id; }); }
  function setMode(m) {
    mode = m;
    $("#go").textContent = m === "in" ? "Sign in" : m === "up" ? "Create account" : "Send reset link";
    $("#toggle").textContent = m === "up" ? "I have an account" : "Create an account";
    $("#pwrow").hidden = m === "reset";
    $("#pw").autocomplete = m === "up" ? "new-password" : "current-password";
    say("");
  }
  function friendly(e) {
    var m = (e && e.message) || "";
    if (/invalid login/i.test(m)) return "That email and password don't match.";
    if (/already registered/i.test(m)) return "That email already has an account. Try signing in.";
    if (/rate|too many/i.test(m)) return "Too many tries. Please wait a minute and try again.";
    if (/password/i.test(m)) return m;
    return "Something went wrong. Please try again.";
  }

  $("#toggle").onclick = function () { setMode(mode === "up" ? "in" : "up"); };
  $("#forgot").onclick = function () { setMode("reset"); };
  $("#form").onsubmit = async function (ev) {
    ev.preventDefault();
    var email = $("#email").value.trim(), pw = $("#pw").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say("Enter a valid email.", "bad");
    $("#go").disabled = true;
    try {
      var redirect = location.origin + location.pathname;
      if (mode === "reset") {
        await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
        say("If that email has an account, a reset link is on its way.", "ok");
      } else if (mode === "up") {
        if (pw.length < 10) return say("Use at least 10 characters.", "bad");
        var r = await sb.auth.signUp({ email: email, password: pw, options: { emailRedirectTo: redirect } });
        if (r.error) throw r.error;
        say("Check your email to confirm your account, then sign in.", "ok");
      } else {
        var s = await sb.auth.signInWithPassword({ email: email, password: pw });
        if (s.error) throw s.error;
      }
    } catch (e) { say(friendly(e), "bad"); }
    finally { $("#go").disabled = false; }
  };

  async function signOut() {
    if (adapter) { adapter._db.close(); adapter = null; }
    $("#frame").removeAttribute("srcdoc"); $("#frame").src = "about:blank";
    await sb.auth.signOut();
  }
  $("#out1").onclick = $("#out2").onclick = signOut;
  $("#back").onclick = function () {
    if (adapter) { adapter._db.close(); adapter = null; }
    $("#frame").src = "about:blank"; show("#home");
  };

  async function home() {
    show("#home");
    $("#who").textContent = session.user.email;
    var r = await sb.from("entitlements").select("edition,active,expires_at").maybeSingle();
    ent = r.data && r.data.active && (!r.data.expires_at || new Date(r.data.expires_at) > new Date()) ? r.data : null;
    var list = $("#list"); list.textContent = "";
    $("#locked").hidden = !!ent; list.hidden = !ent;
    $("#sup").textContent = C.SUPPORT; $("#sup").href = "mailto:" + C.SUPPORT;
    $("#buy").href = C.STORE_URL;
    if (!ent) return;
    LEDGERS.forEach(function (l) {
      var b = document.createElement("button"); b.className = "ghost"; b.type = "button";
      b.textContent = l[1] + (ent.edition === "pro" ? " (Pro)" : "");
      b.onclick = function () { open(l[0], ent.edition === "pro" ? l[0] + "-pro" : l[0], l[1]); };
      list.appendChild(b);
    });
  }

  async function open(file, slug, name) {
    var dl = await sb.storage.from("ledgers").download(file + (ent.edition === "pro" ? "-pro" : "") + ".html");
    if (dl.error) { alert("Couldn't open this ledger. Please try again."); return; }
    var html = await dl.data.text();
    adapter = window.LBAdapter.create(sb, session.user.id, slug, {
      onStatus: function () {}
    });
    window.__lbClaude = adapter;
    // Same-origin srcdoc frame: hand the ledger its cloud database before its own script runs.
    var hook = "<script>window.claude=window.parent.__lbClaude;<\/script>";
    html = html.replace(/<head[^>]*>/i, function (m) { return m + hook; });
    $("#title").textContent = name + " (cloud)";
    show("#run");
    $("#frame").srcdoc = html;
  }

  sb.auth.onAuthStateChange(function (ev, s) {
    session = s;
    if (ev === "PASSWORD_RECOVERY") {
      var np = prompt("Choose a new password (10+ characters)");
      if (np && np.length >= 10) sb.auth.updateUser({ password: np }).then(function (r) { alert(r.error ? "Could not update password." : "Password updated."); });
    }
    if (s) setTimeout(home, 0); else { show("#auth"); setMode("in"); $("#pw").value = ""; }
  });
  sb.auth.getSession().then(function (r) { if (!r.data.session) show("#auth"); });
})();
