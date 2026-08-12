var e=`{
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See examples/shared/graphUi.ts.",
  "sections": [
    {
      "title": "terrain",
      "controls": [
        { "param": "terrain.amount", "label": "relief", "min": 0, "max": 60, "step": 1, "unit": " m" },
        { "param": "terrain.frequency", "label": "noise scale", "min": 0.005, "max": 0.08, "step": 0.001 },
        { "param": "terrain.variant", "label": "variant", "min": 0, "max": 20, "step": 1 }
      ]
    },
    {
      "title": "planting",
      "controls": [
        { "param": "scatter.count", "label": "candidates", "min": 200, "max": 6000, "step": 100 },
        { "param": "gentle.value", "label": "max slope", "min": 0, "max": 0.6, "step": 0.01 },
        { "param": "treeline.value", "label": "treeline", "min": -12, "max": 12, "step": 0.5, "unit": " m" }
      ]
    }
  ]
}
`;export{e as default};