var e=`{
  "_comment": "Panel spec \\u2014 presentation only; the graph cooks identically without it. See shared/graphUi.ts.",
  "sections": [
    {
      "title": "scatter",
      "controls": [
        {
          "param": "scatter.density",
          "label": "density",
          "min": 0.005,
          "max": 0.3,
          "step": 0.005,
          "unit": " /m\\u00b2"
        },
        {
          "param": "scatter.cellSize",
          "label": "cell size",
          "min": 2,
          "max": 40,
          "step": 1,
          "unit": " m"
        },
        {
          "param": "scatter.latticeMode",
          "label": "lattice"
        },
        {
          "param": "scatter.height",
          "label": "height",
          "min": -10,
          "max": 10,
          "step": 0.5,
          "unit": " m"
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
    }
  ]
}
`;export{e as default};