var e=`{
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",
  "sections": [
    {
      "title": "scatter",
      "controls": [
        {
          "param": "scatter.count",
          "label": "candidates",
          "min": 100,
          "max": 6000,
          "step": 100
        },
        {
          "param": "scatter.seed",
          "label": "seed"
        }
      ]
    },
    {
      "title": "thinning",
      "_comment": "Two gates pointing opposite ways, which is the whole shape of this node: 'threshold' reads a cutoff and ignores the seed, 'probabilistic' rolls per point and ignores the cutoff. The graph ships in probabilistic mode, so flipping the one enum swaps which row is on screen with nothing else moving.",
      "controls": [
        {
          "param": "thin.mode",
          "label": "mode"
        },
        {
          "param": "thin.threshold",
          "label": "threshold",
          "min": 0,
          "max": 1,
          "step": 0.01,
          "visibleWhen": { "thin.mode": "threshold" }
        },
        {
          "param": "thin.seed",
          "label": "seed",
          "visibleWhen": { "thin.mode": "probabilistic" }
        }
      ]
    }
  ]
}
`;export{e as default};