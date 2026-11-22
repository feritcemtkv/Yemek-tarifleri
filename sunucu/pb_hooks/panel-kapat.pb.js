/// <reference path="../pb_data/types.d.ts" />
// Yönetim paneli (/_/) internetten kapalı. Cloudflare Tunnel'dan gelen her istek
// Cf-Connecting-Ip başlığını taşır; böyle bir istek panele giremez. Panel yalnızca
// Surface'ın kendisinden veya SSH tüneliyle (http://127.0.0.1:8095/_/) açılır.
routerUse((e) => {
  const yol = e.request.url.path;
  if ((yol === "/_" || yol.startsWith("/_/") || yol.startsWith("/api/collections/_superusers")) &&
      e.request.header.get("Cf-Connecting-Ip")) {
    return e.json(403, { message: "Bu sayfa internetten kapalı." });
  }
  return e.next();
});
