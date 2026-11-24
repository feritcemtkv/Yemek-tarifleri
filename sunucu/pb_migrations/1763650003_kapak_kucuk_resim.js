/// <reference path="../pb_data/types.d.ts" />
// Bilgisayardaki geniş kartlar için 800x600 kırpılmış kapak küçük resmi.
migrate((app) => {
  const c = app.findCollectionByNameOrId("tarifler");
  const f = c.fields.getByName("kapak");
  f.thumbs = ["400x400f", "800x600"];
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("tarifler");
  c.fields.getByName("kapak").thumbs = ["400x400f"];
  app.save(c);
});
