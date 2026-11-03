/* Ledger Brothers Cloud: Supabase adapter.
   Implements the small Firestore-style interface the built ledgers already call through
   window.claude.use("db"), on top of the public.ledger_docs table (row-level security).
   Usage: window.LBAdapter.create(supabaseClient, userId, ledgerSlug) -> object to assign to window.claude */
(function (root) {
  "use strict";
  var PAGE = 1000;

  function newId() {
    var a = new Uint8Array(9);
    (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return "i" + Array.prototype.map.call(a, function (b) { return b.toString(36).padStart(2, "0"); }).join("").slice(0, 14);
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  function create(sb, userId, ledger, opts) {
    opts = opts || {};
    var onStatus = opts.onStatus || function () {};
    var colls = {}; // name -> {rows: Map(id->data), subs:Set, loaded:bool, loading:Promise}

    function state(name) {
      return colls[name] || (colls[name] = { rows: new Map(), subs: new Set(), loaded: false, loading: null, channel: null });
    }

    function fail(err) { onStatus({ ok: false, error: err }); throw err; }

    function snapshotOf(name, q) {
      var rows = Array.from(state(name).rows, function (kv) { return { id: kv[0], d: kv[1] }; });
      if (q && q.order) {
        var f = q.order.field, dir = q.order.dir === "desc" ? -1 : 1;
        rows.sort(function (a, b) {
          var x = a.d[f], y = b.d[f];
          return x === y ? 0 : (x > y ? 1 : -1) * dir;
        });
      }
      if (q && q.limit) rows = rows.slice(0, q.limit);
      return { docs: rows.map(function (r) { return { id: r.id, data: function () { return clone(r.d); } }; }) };
    }

    function notify(name) {
      state(name).subs.forEach(function (s) { try { s.fire(); } catch (e) { /* keep others alive */ } });
    }

    function load(name) {
      var st = state(name);
      if (st.loading) return st.loading;
      st.loading = (async function () {
        var from = 0, got;
        do {
          var res = await sb.from("ledger_docs").select("id,data")
            .eq("user_id", userId).eq("ledger", ledger).eq("coll", name).eq("deleted", false)
            .order("updated_at", { ascending: false }).range(from, from + PAGE - 1);
          if (res.error) { st.loading = null; return fail(res.error); }
          got = res.data || [];
          got.forEach(function (r) { if (!st.rows.has(r.id)) st.rows.set(r.id, r.data || {}); });
          from += PAGE;
        } while (got.length === PAGE && from < 25000);
        st.loaded = true;
        onStatus({ ok: true });
      })();
      return st.loading;
    }

    function listen(name) {
      var st = state(name);
      if (st.channel) return;
      st.channel = sb.channel("lb-" + ledger + "-" + name + "-" + newId())
        .on("postgres_changes",
          { event: "*", schema: "public", table: "ledger_docs", filter: "user_id=eq." + userId },
          function (p) {
            var r = p.new || {};
            if (r.ledger !== ledger || r.coll !== name) return;
            if (r.deleted) st.rows.delete(r.id); else st.rows.set(r.id, r.data || {});
            notify(name);
          })
        .subscribe();
    }

    async function write(name, id, data, deleted) {
      var res = await sb.from("ledger_docs").upsert(
        { user_id: userId, ledger: ledger, coll: name, id: id, data: data, deleted: !!deleted },
        { onConflict: "user_id,ledger,coll,id" });
      if (res.error) return fail(res.error);
      onStatus({ ok: true });
    }

    function docRef(name, id) {
      id = id || newId();
      return {
        id: id,
        set: function (obj) {
          var st = state(name), data = clone(obj) || {};
          st.rows.set(id, data); notify(name);
          return write(name, id, data, false);
        },
        update: function (part) {
          var st = state(name), data = Object.assign({}, st.rows.get(id) || {}, clone(part));
          st.rows.set(id, data); notify(name);
          return write(name, id, data, false);
        },
        delete: function () {
          var st = state(name), prev = st.rows.get(id) || {};
          st.rows.delete(id); notify(name);
          return write(name, id, prev, true);
        },
        onSnapshot: function (cb, errCb) {
          var st = state(name), sub = {
            fire: function () {
              var d = st.rows.get(id);
              cb({ id: id, exists: d !== undefined, data: function () { return clone(d); } });
            }
          };
          st.subs.add(sub); listen(name);
          load(name).then(function () { sub.fire(); }, function (e) { if (errCb) errCb(e); });
          return function () { st.subs.delete(sub); };
        }
      };
    }

    function query(name, q) {
      q = q || {};
      return {
        orderBy: function (field, dir) { return query(name, Object.assign({}, q, { order: { field: field, dir: dir || "asc" } })); },
        limit: function (n) { return query(name, Object.assign({}, q, { limit: n })); },
        where: function (field, op, value) { return query(name, Object.assign({}, q, { where: { field: field, op: op, value: value } })); },
        onSnapshot: function (cb, errCb) {
          var st = state(name), sub = { fire: function () { cb(snapshotOf(name, q)); } };
          st.subs.add(sub); listen(name);
          load(name).then(function () { sub.fire(); }, function (e) { if (errCb) errCb(e); });
          return function () { st.subs.delete(sub); };
        },
        get: async function () {
          await load(name);
          var w = q.where, rows = snapshotOf(name, q).docs;
          if (w) {
            rows = snapshotOf(name, { order: q.order }).docs.filter(function (d) {
              var v = d.data()[w.field];
              if (w.op === "==") return v === w.value;
              if (w.op === "<") return v < w.value;
              if (w.op === ">") return v > w.value;
              return false;
            });
            if (q.limit) rows = rows.slice(0, q.limit);
          }
          return { docs: rows, empty: !rows.length };
        }
      };
    }

    function collection(name) {
      if (["items", "log", "config"].indexOf(name) < 0) throw new Error("Unknown collection");
      var base = query(name, {});
      base.doc = function (id) { return docRef(name, id); };
      base.add = function (obj) {
        var r = docRef(name); return r.set(obj).then(function () { return { id: r.id }; });
      };
      return base;
    }

    var db = {
      collection: collection,
      doc: function (path) {
        var p = String(path).split("/");
        if (p.length !== 2) throw new Error("Bad path");
        return docRef(p[0] === "config" ? "config" : p[0], p[1]);
      },
      close: function () {
        Object.keys(colls).forEach(function (n) {
          if (colls[n].channel) { sb.removeChannel(colls[n].channel); colls[n].channel = null; }
        });
      }
    };

    return {
      use: function (name) {
        if (name === "db") return Promise.resolve(db);
        return Promise.resolve(null); // downloads etc.: the ledger falls back to its built-in handling
      },
      _db: db
    };
  }

  root.LBAdapter = { create: create };
  if (typeof module !== "undefined") module.exports = root.LBAdapter;
})(typeof window !== "undefined" ? window : globalThis);
