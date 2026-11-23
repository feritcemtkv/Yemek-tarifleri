/// <reference path="../pb_data/types.d.ts" />
// Yönetim paneli (/_/) dışarıdan kapalı. Tailscale Serve, Cloudflare Tunnel ya da başka bir
// vekil üzerinden gelen istekler bu başlıklardan birini taşır ve panele giremez. Panel yalnızca
// Surface'ın kendisinden veya SSH tüneliyle (http://127.0.0.1:8095/_/) açılır.
routerUse((e) => {
  const yol = e.request.url.path;
  if ((yol === "/_" || yol.startsWith("/_/") || yol.startsWith("/api/collections/_superusers")) &&
      (e.request.header.get("Cf-Connecting-Ip") || e.request.header.get("X-Forwarded-For") ||
       e.request.header.get("Tailscale-User-Login") || e.request.header.get("Tailscale-Headers-Info"))) {
    return e.json(403, { message: "Bu sayfa internetten kapalı." });
  }
  return e.next();
});
