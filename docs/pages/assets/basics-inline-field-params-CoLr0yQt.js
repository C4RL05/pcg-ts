var e=`{
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",
  "sections": [
    {
      "title": "dunes",
      "controls": [
        {
          "param": "dunes.translate.amplitude",
          "label": "height",
          "description": "Dune height in world units, multiplied into the normalized fBm after it is centred on zero, so 0 gives a flat grid.",
          "min": 0,
          "max": 50,
          "step": 0.5
        },
        {
          "param": "dunes.translate.frequency",
          "label": "frequency",
          "description": "Scale applied to the noise sample position, so a larger value means smaller dunes.",
          "min": 0.01,
          "max": 0.2,
          "step": 0.005
        }
      ]
    }
  ]
}
`;export{e as default};