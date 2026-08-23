var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts. The count ceiling is deliberate: this graph costs about 14.5 us per point on the CPU, so 200k is roughly three seconds of blocked tab, which is the most a page with no cook budget should be able to ask for. The device path is what makes that count comfortable, and comparing the two is the point of the graph.",\r
  "sections": [\r
    {\r
      "title": "cloud",\r
      "controls": [\r
        {\r
          "param": "scatter.count",\r
          "label": "points",\r
          "min": 1000,\r
          "max": 200000,\r
          "step": 1000\r
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
      "title": "chain",\r
      "controls": [\r
        {\r
          "param": "jitter.seed",\r
          "label": "jitter seed"\r
        },\r
        {\r
          "param": "place.rotateEuler",\r
          "label": "rotate"\r
        },\r
        {\r
          "param": "place.scale",\r
          "label": "scale"\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};