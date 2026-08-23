var e=`{\r
  "_comment": "Panel spec \\u2014 presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "grid",\r
      "controls": [\r
        {\r
          "param": "grid.countX",\r
          "label": "columns",\r
          "min": 1,\r
          "max": 40,\r
          "step": 1\r
        },\r
        {\r
          "param": "grid.countZ",\r
          "label": "rows",\r
          "min": 1,\r
          "max": 40,\r
          "step": 1\r
        },\r
        {\r
          "param": "grid.spacing",\r
          "label": "spacing"\r
        }\r
      ]\r
    },\r
    {\r
      "title": "transform",\r
      "controls": [\r
        {\r
          "param": "place.translate",\r
          "label": "move"\r
        },\r
        {\r
          "param": "place.rotateEuler",\r
          "label": "turn"\r
        },\r
        {\r
          "param": "place.scale",\r
          "label": "size"\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};