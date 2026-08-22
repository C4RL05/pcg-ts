var e=`{
  "_comment": "Panel spec \\u2014 presentation only; the graph cooks identically without it. See shared/graphUi.ts.",
  "sections": [
    {
      "title": "scatter",
      "controls": [
        {
          "param": "scatter.count",
          "label": "points",
          "min": 50,
          "max": 2000,
          "step": 25
        },
        {
          "param": "scatter.boundsMin",
          "label": "bounds min"
        },
        {
          "param": "scatter.boundsMax",
          "label": "bounds max"
        },
        {
          "param": "scatter.seed",
          "label": "seed"
        }
      ]
    },
    {
      "title": "spawn",
      "controls": [
        {
          "param": "spawn.assetId",
          "label": "asset"
        }
      ]
    }
  ]
}
`;export{e as default};