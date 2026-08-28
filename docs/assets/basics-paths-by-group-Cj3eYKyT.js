var e=`{
  "_comment": "Panel spec \\u2014 presentation only; the graph cooks identically without it. See shared/graphUi.ts.",
  "sections": [
    {
      "title": "grid",
      "controls": [
        {
          "param": "grid.countX",
          "label": "points per row",
          "min": 2,
          "max": 40,
          "step": 1
        },
        {
          "param": "grid.countZ",
          "label": "rows",
          "min": 1,
          "max": 20,
          "step": 1
        },
        {
          "param": "grid.spacing",
          "label": "spacing"
        }
      ]
    },
    {
      "title": "paths",
      "controls": [
        {
          "param": "paths.closed",
          "label": "close each path"
        }
      ]
    }
  ]
}
`;export{e as default};