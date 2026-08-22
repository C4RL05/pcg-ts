var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "cloud",\r
      "controls": [\r
        {\r
          "param": "scatter.count",\r
          "label": "points",\r
          "min": 100,\r
          "max": 4000,\r
          "step": 50\r
        },\r
        {\r
          "param": "scatter.seed",\r
          "label": "scatter seed"\r
        },\r
        {\r
          "param": "scatter.boundsMin",\r
          "label": "bounds min"\r
        },\r
        {\r
          "param": "scatter.boundsMax",\r
          "label": "bounds max"\r
        }\r
      ]\r
    },\r
    {\r
      "title": "groups",\r
      "controls": [\r
        {\r
          "param": "groups.name",\r
          "label": "split on"\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};