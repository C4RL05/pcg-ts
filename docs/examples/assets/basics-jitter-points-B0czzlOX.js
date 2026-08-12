var e=`{
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See examples/shared/graphUi.ts.",
  "sections": [
    {
      "title": "lattice",
      "controls": [
        { "param": "grid.countX", "label": "columns", "min": 2, "max": 64, "step": 1 },
        { "param": "grid.countZ", "label": "rows", "min": 2, "max": 64, "step": 1 },
        { "param": "grid.spacing", "label": "spacing" }
      ]
    },
    {
      "title": "jitter",
      "controls": [
        { "param": "jitter.amount", "label": "amount" },
        { "param": "jitter.seed", "label": "seed" }
      ]
    }
  ]
}
`;export{e as default};