/// <reference path="../pb_data/types.d.ts" />
// Uygulama dosyaları (index.html, app.js, sw.js…) her açılışta sunucuya sorulsun; değişmemişse
// tarayıcı kendi kopyasını kullanır (304). Böylece güncellemeler hemen görünür.
routerUse((e) => {
  const yol = e.request.url.path;
  if (!yol.startsWith("/api/") && !yol.startsWith("/_")) {
    e.response.header().set("Cache-Control", "no-cache");
  }
  return e.next();
});
