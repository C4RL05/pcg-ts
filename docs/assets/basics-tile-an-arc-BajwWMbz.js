var e=`{
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",
  "sections": [
    {
      "title": "the mouths",
      "controls": [
        {
          "param": "cover.flare",
          "label": "flare",
          "description": "Arc distance over which each end of a range opens. At 0 every stretch starts at full section — a wall with a hole in it. Past half a range's length (26, 27.5 and 33 for the three here) the two mouths meet and every tile of it is ramped, which is legal: the ramps do not add, each tile taking the nearer mouth's.",
          "min": 0,
          "max": 40,
          "step": 0.5
        },
        {
          "param": "cover.taper",
          "label": "taper at the mouth",
          "description": "The scale a tile reaches at the very mouth, applied to the two components that are NOT the axis — so the cross-section opens and the length along the path never does. Below 1 the run pinches away to nothing at its ends instead.",
          "min": 0.2,
          "max": 3,
          "step": 0.05
        }
      ]
    }
  ]
}
`;export{e as default};