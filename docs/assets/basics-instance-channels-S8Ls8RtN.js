var e=`{
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts. \`spawn.instanceAttrs\` is deliberately absent: a stringList has no widget, so listing it would silently show nothing.",
  "sections": [
    {
      "title": "scatter",
      "controls": [
        { "param": "scatter.count", "label": "points", "min": 50, "max": 2000, "step": 25 },
        { "param": "scatter.boundsMin", "label": "bounds min" },
        { "param": "scatter.boundsMax", "label": "bounds max" },
        { "param": "scatter.seed", "label": "seed" }
      ]
    },
    {
      "title": "spawn",
      "controls": [
        { "param": "spawn.assetId", "label": "asset" },
        { "param": "spawn.colorAttr", "label": "colour attr" }
      ]
    }
  ]
}
`;export{e as default};