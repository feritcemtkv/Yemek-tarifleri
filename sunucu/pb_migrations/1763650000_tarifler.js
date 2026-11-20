/// <reference path="../pb_data/types.d.ts" />
// Tarif arşivi: "tarifler" koleksiyonunu kurar ve dışarıdan kayıt olmayı kapatır.
// PocketBase v0.23 ve sonrası içindir; "pocketbase serve" ilk açılışta kendisi çalıştırır.
migrate((app) => {
  const girisli = "@request.auth.id != ''";

  const tarifler = new Collection({
    type: "base",
    name: "tarifler",
    listRule: girisli,
    viewRule: girisli,
    createRule: girisli,
    updateRule: girisli,
    deleteRule: girisli,
    fields: [
      { type: "text", name: "title", required: true, max: 300 },
      { type: "text", name: "category", max: 100 },
      { type: "json", name: "ingredients", maxSize: 200000 },
      { type: "text", name: "instructions", max: 50000 },
      { type: "text", name: "url", max: 2000 },
      { type: "bool", name: "favorite" },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_tarifler_created ON tarifler (created)"],
  });
  app.save(tarifler);

  // Varsayılan "users" koleksiyonunda herkes kayıt olabiliyor; kapat.
  const users = app.findCollectionByNameOrId("users");
  users.createRule = null;
  app.save(users);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("tarifler"));
});
