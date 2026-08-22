var e=`{
  "_comment": "Panel spec \\u2014 presentation only; the graph cooks identically without it. See shared/graphUi.ts.",
  "sections": [
    {
      "title": "grid",
      "controls": [
        {
          "param": "grid.countX",
          "label": "columns",
          "min": 1,
          "max": 40,
          "step": 1
        },
        {
          "param": "grid.countZ",
          "label": "rows",
          "min": 1,
          "max": 40,
          "step": 1
        },
        {
          "param": "grid.spacing",
          "label": "spacing"
        }
      ]
    },
    {
      "title": "transform",
      "controls": [
        {
          "param": "place.translate",
          "label": "move"
        },
        {
          "param": "place.rotateEuler",
          "label": "turn"
        },
        {
          "param": "place.scale",
          "label": "size"
        }
      ]
    }
  ]
}
`;export{e as default};