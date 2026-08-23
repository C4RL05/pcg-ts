var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "dunes",\r
      "controls": [\r
        {\r
          "param": "dunes.translate.amplitude",\r
          "label": "height",\r
          "description": "Vertical scale on the fBm after it is centred on zero, so 0 gives a flat grid. It is a scale and not a measurement: a normalized fBm almost never reaches its own extremes, so the relief that actually lands is roughly two fifths of this number — 24 here gives a grid about 10 units deep across 20 units of ground.",\r
          "min": 0,\r
          "max": 48,\r
          "step": 0.5\r
        },\r
        {\r
          "param": "dunes.translate.frequency",\r
          "label": "frequency",\r
          "description": "Scale applied to the sample position before the noise reads it, so a larger value packs more, smaller dunes into the same 20-unit grid. Past about 0.3 the dunes are finer than the quarter-unit point spacing can carry and the surface starts reading as speckle.",\r
          "min": 0.03,\r
          "max": 0.3,\r
          "step": 0.005\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};