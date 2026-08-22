var e=`{
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",
  "sections": [
    {
      "title": "dunes",
      "controls": [
        {
          "param": "dunes.translate.amplitude",
          "label": "height",
          "description": "Vertical scale on the fBm after it is centred on zero, so 0 gives a flat grid. It is a scale and not a measurement: a normalized fBm almost never reaches its own extremes, so the relief that actually lands is roughly two fifths of this number — 24 here gives a grid about 10 units deep across 20 units of ground.",
          "min": 0,
          "max": 48,
          "step": 0.5
        },
        {
          "param": "dunes.translate.frequency",
          "label": "frequency",
          "description": "Scale applied to the sample position before the noise reads it, so a larger value packs more, smaller dunes into the same 20-unit grid. Past about 0.3 the dunes are finer than the quarter-unit point spacing can carry and the surface starts reading as speckle.",
          "min": 0.03,
          "max": 0.3,
          "step": 0.005
        }
      ]
    }
  ]
}
`;export{e as default};