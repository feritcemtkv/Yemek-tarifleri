/// <reference path="../pb_data/types.d.ts" />
// Instagram'dan tarif çıkarma kuyruğu. Uygulama istek ekler, Surface'taki işçi
// (isci/tarif-isci.py) videoyu indirip Claude'a izletir ve tarifi kaydeder.
migrate((app) => {
  const girisli = "@request.auth.id != ''";
  const tarifler = app.findCollectionByNameOrId("tarifler");
  const c = new Collection({
    type: "base",
    name: "istekler",
    listRule: girisli,
    viewRule: girisli,
    createRule: girisli,
    updateRule: girisli,
    deleteRule: girisli,
    fields: [
      { type: "text", name: "url", max: 2000 },
      { type: "text", name: "metin", max: 50000 },  // bağlantı yerine yapıştırılan tarif metni
      { type: "select", name: "durum", required: true, maxSelect: 1,
        values: ["bekliyor", "isleniyor", "bitti", "hata"] },
      { type: "text", name: "adim", max: 200 },
      { type: "text", name: "mesaj", max: 2000 },
      { type: "relation", name: "tarif", collectionId: tarifler.id, maxSelect: 1, cascadeDelete: false },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_istekler_durum ON istekler (durum)"],
  });
  app.save(c);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("istekler"));
});
