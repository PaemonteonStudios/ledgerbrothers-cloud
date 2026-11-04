(function () {
  "use strict";
  var n = document.getElementById("notice"), ok = document.getElementById("noticeok"), seen = false;
  try { seen = localStorage.getItem("lb_notice") === "1"; } catch (e) {}
  if (!seen) n.hidden = false;
  ok.onclick = function () { n.hidden = true; try { localStorage.setItem("lb_notice", "1"); } catch (e) {} };
})();
