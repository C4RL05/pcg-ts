var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "the mouths",\r
      "controls": [\r
        {\r
          "param": "cover.flare",\r
          "label": "flare",\r
          "description": "Arc distance over which each end of a range opens. At 0 every stretch starts at full section — a wall with a hole in it. Past half a range's length (26, 27.5 and 33 for the three here) the two mouths meet and every tile of it is ramped, which is legal: the ramps do not add, each tile taking the nearer mouth's.",\r
          "min": 0,\r
          "max": 40,\r
          "step": 0.5\r
        },\r
        {\r
          "param": "cover.taper",\r
          "label": "taper at the mouth",\r
          "description": "The scale a tile reaches at the very mouth, applied to the two components that are NOT the axis — so the cross-section opens and the length along the path never does. Below 1 the run pinches away to nothing at its ends instead.",\r
          "min": 0.2,\r
          "max": 3,\r
          "step": 0.05\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};