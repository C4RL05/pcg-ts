var e=`{
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",
  "sections": [
    {
      "title": "spacing",
      "controls": [
        { "param": "scatter.count", "label": "candidates", "min": 200, "max": 8000, "step": 100 },
        {
          "param": "prune.minDistance",
          "label": "min distance",
          "min": 0.5,
          "max": 10,
          "step": 0.1,
          "unit": " m"
        },
        { "param": "scatter.boundsMin", "label": "bounds min" },
        { "param": "scatter.boundsMax", "label": "bounds max" }
      ]
    }
  ]
}
`;export{e as default};