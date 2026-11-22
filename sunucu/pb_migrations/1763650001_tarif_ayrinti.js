/// <reference path="../pb_data/types.d.ts" />
// Eski arşivdeki ayrıntılar: porsiyon, süreler, notlar, Thermomix adımları, kapak, video.
migrate((app) => {
  const c = app.findCollectionByNameOrId("tarifler");
  c.fields.add(new TextField({ name: "porsiyon", max: 100 }));
  c.fields.add(new TextField({ name: "hazirlik", max: 100 }));
  c.fields.add(new TextField({ name: "pisirme", max: 100 }));
  c.fields.add(new TextField({ name: "notlar", max: 20000 }));
  c.fields.add(new TextField({ name: "thermomix", max: 20000 }));
  c.fields.add(new TextField({ name: "yazar", max: 200 }));
  c.fields.add(new TextField({ name: "kod", max: 100 }));   // Instagram kısa kodu; tekrar aktarmayı önler
  c.fields.add(new FileField({
    name: "kapak", maxSelect: 1, maxSize: 10 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    thumbs: ["400x400f"],
  }));
  c.fields.add(new FileField({
    name: "video", maxSelect: 1, maxSize: 300 * 1024 * 1024,
    mimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
  }));
  c.addIndex("idx_tarifler_kod", false, "kod", "kod != ''");
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("tarifler");
  for (const ad of ["porsiyon", "hazirlik", "pisirme", "notlar", "thermomix", "yazar", "kod", "kapak", "video"]) {
    c.fields.removeByName(ad);
  }
  c.removeIndex("idx_tarifler_kod");
  app.save(c);
});
