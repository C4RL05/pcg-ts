var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "the route",\r
      "controls": [\r
        { "param": "coil.turns", "label": "turns", "min": 1, "max": 6, "step": 1 },\r
        {\r
          "param": "lap.spacing",\r
          "label": "sample spacing",\r
          "min": 0.3,\r
          "max": 3,\r
          "step": 0.1,\r
          "unit": " m"\r
        },\r
        {\r
          "param": "stations.spacing",\r
          "label": "panel spacing",\r
          "min": 2,\r
          "max": 10,\r
          "step": 0.5,\r
          "unit": " m"\r
        }\r
      ]\r
    },\r
    {\r
      "title": "the fan",\r
      "controls": [\r
        { "param": "cover.rayCount", "label": "rays", "min": 1, "max": 12, "step": 1 },\r
        {\r
          "param": "cover.spread",\r
          "label": "half span",\r
          "min": 0,\r
          "max": 6,\r
          "step": 0.1,\r
          "unit": " m"\r
        },\r
        { "param": "cover.minHits", "label": "rays needed", "min": 1, "max": 6, "step": 1 }\r
      ]\r
    },\r
    {\r
      "title": "the ceiling",\r
      "controls": [\r
        {\r
          "param": "cover.near",\r
          "label": "ray start",\r
          "min": -2,\r
          "max": 6,\r
          "step": 0.1,\r
          "unit": " m"\r
        },\r
        {\r
          "param": "cover.far",\r
          "label": "ray end",\r
          "min": 1,\r
          "max": 40,\r
          "step": 0.5,\r
          "unit": " m"\r
        },\r
        { "param": "cover.boxSize", "label": "asset extent" }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};