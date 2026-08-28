var e=`{
  "formatVersion": 1,
  "seed": 3311,
  "meta": {
    "title": "fit a line through each row of props, and catch the row that only looks straight",
    "description": "\`pathRuns\` cuts a path into runs at points something FLAGGED, and the flag has to come from somewhere. Nothing flags a row of posts: what separates one row from the next is empty arc, and a gap is a fact about TWO points at once — the shape of fact a field cannot state, because a field resolves each element from that element alone, and no boolean column exists to carry it until someone has already found the runs. \`runFit\` is the gap-delimited half of the family: it cuts at an along-arc distance, least-squares fits a numeric attribute against arc position inside each run, and writes slope, worst residual and span back onto every point of the run. Five rows of props are threaded onto one lap here — four of twenty and one of two — and the verdict is a colour with three values: GREEN for a row that really is a line, RED for one that is not, BLUE for one there is not enough of to say.\\n\\nTHE ANSWER IS PER RUN AND IT LANDS ON EVERY POINT OF IT. A run is not a primitive — one path holds five of them, so the primitive domain has no element to hold one — and repeating the verdict per point is also the shape it gets used in, since every consumer is a per-point decision. The repetition is what the picture is made of. One row is nineteen posts on a line plus ONE post four units off it, and all twenty come out red, because the verdict belongs to the run and every member carries it. That row is also why the residual is the WORST member rather than an RMS: fitted from the offsets this graph builds, its worst residual is 3.762 and its RMS is 0.867, so a rule reading 'no post sits further than a unit off the line' fails on the worst and PASSES on the mean. An RMS lets one straggler hide behind nineteen good members, which is exactly the arrangement that reads as a line to the eye.\\n\\nTHE BLUE PAIR IS THE MISTAKE THE NODE MOST WANTS YOU TO AVOID. Its residual is 0 — exactly, not nearly — because a line through two points is always perfect, and its slope of 6.878 is an invented number reported as confidently as any other. Those two posts sit 0.87 units apart along the road and 6 units apart across it: nothing anyone would call a row. \`countAttr\` is the only column that says so, which is why the colour is \`runResidual < 1\` ANDed with \`runCount > 2\` rather than the residual alone — straight is evidence only above three members, and a residual is compared against a threshold rather than against zero for the same reason every float is.\\n\\nTHE FIT IS AGAINST RUN-LOCAL ARC, and that is invisible when it works. A least-squares fit only ever uses \`s - mean(s)\`, so fitting an order-1 offset against an order-300 lap coordinate subtracts away every leading digit the coordinate was written with. \`runFit\` rebases each run on its own start before summing anything, which is THE SAME LINE THROUGH THE SAME POINTS — a fit is translation-invariant in the abscissa, so slope and residual are unchanged — computed where the numbers are small, and exactly rather than approximately. The check is in the graph: take those twenty offsets against their own \`station\` column with its first value subtracted off and they fit slope 0.303882 with a worst residual of 3.762323; the node, fitting them where they actually lie from station 179.67, reports 0.303882 and 3.762323. Every digit, because a constant is the only thing standing between the two abscissae.\\n\\nWHAT THAT INVARIANCE DOES NOT COVER IS A CHANGE OF RULER, and the difference is worth spelling out because it wears the same clothes. The demonstration used to be made the other way round, against an evenly spaced LADDER from zero — twenty rungs one 360th of the lap apart — and under the coordinate this graph used to build that was the same abscissa with a constant taken off it, since \`curveU\` times a length IS an even ladder. The two agreed to seven figures at 0.3038327. Against \`station\` they do not: the ladder gives 0.303875 and a worst residual of 3.762406, the node gives 0.303882 and 3.762323, and they part company in the FIFTH digit. Neither fit is wrong and nothing has drifted; the ladder is simply no longer the column moved but a DIFFERENT abscissa, and the distance between them has two named parts. 140 parts per million of it is the ruler swap, which is a SCALE — the emitted lap is 313.99 where the curve is 314.03, so a ladder built on it steps 0.87219 rather than 0.87231, and a scale multiplies a slope where a translation leaves it alone. The remaining 23 parts per million is that the real column is not a ladder at all: its steps run from 0.87126 where the road bends hardest to 0.87233 where it bends least. Read that fifth digit as a different question answered rather than as the same question answered worse — the invariance is intact, and rebasing the column on itself is what shows it. \`runStart\` still reports the lap position (179.67) rather than the zero the fit used, because a start is a range other nodes have to be able to read.\\n\\nTHE ARC COORDINATE IS THE ROAD'S, NOT THE PROPS' OWN. \`arcAttr\` names \`station\`, and \`station\` is \`pathResample\`'s \`sampleArcAttr\`: each sample's own arc position from the start of its path, in world units, handed over by the walk that placed the samples rather than reconstructed afterwards. Left empty, \`runFit\` would measure the polyline threaded through the PROPS instead, and the props stand up to 7 units off the kerb, so the 3D chord between two of them carries their lateral offsets as well as their spacing. Cooked that way this same graph reports the parallel row as spanning 17.57 units instead of 16.57 and the wobbling row as 53.70 instead of 16.57, and it CUTS THE PAIR IN HALF: their chord is 6.07 where the road distance between them is 0.87, so a 5-unit gap finds a break the road never had and two one-point runs appear, whose residuals are also 0.\\n\\nTHE RULER HAS TO BE THE ONE THE CONSUMER WALKS, AND THIS GRAPH USED TO GET THAT WRONG. It built \`station\` by hand as \`curveU\` times the lap length, which is arithmetic anyone would write and is two rulers in one expression: \`curveU\` is a fraction of the INPUT CURVE, while what every node downstream actually steps along is the chord polyline THROUGH the samples, which cuts corners and comes back shorter — 313.99 against 314.03 here. That is why \`pathResample\` reports both lengths and why the emitted one is the one to reach for. The 140 parts per million between them is a NET figure rather than a factor anybody could divide back out, and that is the whole complaint: all of it accrues over the BENDS and none of it where the road runs straightest, so a hand-built coordinate agrees with the road on the straights, where nothing is at stake, and drifts through the corners, where a placement rule is reading it. \`sampleArcAttr\` is the same coordinate asked for as one parameter on the node that already knows it, it restarts per path, and it lands on the points, so nothing has to be multiplied together to obtain it.\\n\\nNAMING A COORDINATE MEANS NAMING ITS \`period\` TOO, AND THE PERIOD COMES OFF THE SAME RULER. A wrap length taken from the curve under an arc column taken from the emitted polyline is the two-ruler mistake wearing a different hat — the period is that coordinate's own wrap point, not a nearby number of about the right size. So \`resampledLengthAttr\` publishes the emitted lap length on the primitive domain and the two \`promoteAttribute\` nodes carry it across: a period is one value per PATH, the path the fit runs on is a NEW one that \`pointsToPath\` builds out of the points, and a primitive attribute does not survive that trip. Primitive to point on the lap, point to primitive on the props. That pair is what the PERIOD costs; the coordinate itself now costs a parameter.\\n\\nTHE SEAM IS NOT A BREAK. One row is laid deliberately ACROSS the start/finish line, ten posts before it and ten after, and with \`wrap\` on the walk starts at the first REAL gap rather than at vertex zero, so those twenty stay ONE run: one slope of 0.3440, one span of 16.57, one worst residual of 0.00018, and a \`runStart\` of 305.27 that is larger than the station of its own last member. THAT RESIDUAL USED TO READ ZERO, AND THE ZERO WAS AN ARTEFACT — worth a sentence, because an exact zero out of a least-squares fit is precisely what a reader would take as the definition of straight. Those offsets are 0.3 times a counter that advances once per SAMPLE, while the arc advances one CHORD per sample — 0.87126 through the tightest bend, 0.87233 through the loosest — so a quantity linear in the index is not quite linear in distance, and 0.00018 is the fit noticing. Against the hand-built coordinate it could not notice: \`curveU\` times a length IS the sample index times a constant, so the row was being fitted against a rescaled copy of the counter that generated it, and no fit can miss that. A row that is straight ON THE ROAD reads as 0.00018 off a line in arc, four decimal places under the threshold, which is the second reason the colour compares \`runResidual\` against 1 rather than against zero. Set \`wrap\` false and it becomes two rows of ten, slopes agreeing to five digits at 0.34397 and residuals of 0.00016 and 0.00015, each too short for any rule to act on, and nothing in the columns complains. Leaving \`period\` at 0 while naming an \`arcAttr\` used to do the same thing silently, and writing this graph is what found it: a period of 0 means THIS path's own measured length, which here is the 371.57-unit zig-zag through the props where the coordinate wraps at the road's 313.99, so the seam gap comes out near 58 instead of 0.87 and a break appears where the road has none. BOTH of those are world-unit lengths, which is what makes the combination worth refusing rather than explaining: no units check catches it, because the question is not what units the coordinate is in but WHICH POLYLINE it was measured along. The node now REFUSES that combination rather than inventing one — the mistake a graph cannot make is better than the mistake a graph explains. A line of eight objects across the start line reading as two lines of four is the bug this whole family agrees about the seam to prevent. The re-threading at the end is \`pointsToPath\` grouped on \`runId\` and ordered by \`runIndex\` — the group key and the within-run position runFit hands out — and it is what draws that row as one arc crossing the line instead of a chord across the middle of the lap, because \`runIndex\` counts in the walk order the runs were cut in. The second output is the lap itself, so the rows can be read against the road they were measured along.",
    "tags": ["basics", "path", "runs", "fit", "closed"]
  },
  "nodes": [
    {
      "id": "loop",
      "type": "subgraph",
      "params": { "count": 64, "size": [50, 50, 50] },
      "ref": { "name": "shape/path-loop" }
    },
    {
      "id": "lap",
      "type": "pathResample",
      "params": {
        "mode": "count",
        "count": 360,
        "resampledLengthAttr": "lapLength",
        "sampleArcAttr": "station"
      }
    },
    {
      "id": "len",
      "type": "promoteAttribute",
      "params": { "name": "lapLength", "from": "primitive", "to": "point", "mode": "average" }
    },
    {
      "id": "u",
      "type": "setAttribute",
      "params": {
        "name": "u",
        "tupleSize": 1,
        "value": {
          "fn": "mod",
          "args": [{ "fn": "add", "args": [{ "fn": "index" }, 10] }, 72]
        }
      }
    },
    {
      "id": "c",
      "type": "setAttribute",
      "params": {
        "name": "c",
        "tupleSize": 1,
        "value": {
          "fn": "mod",
          "args": [
            {
              "fn": "floor",
              "args": [
                { "fn": "div", "args": [{ "fn": "add", "args": [{ "fn": "index" }, 10] }, 72] }
              ]
            },
            5
          ]
        }
      }
    },
    {
      "id": "off",
      "type": "setAttribute",
      "params": {
        "name": "off",
        "tupleSize": 1,
        "value": {
          "fn": "select",
          "args": [
            { "fn": "lt", "args": [{ "fn": "attribute", "name": "c" }, 0.5] },
            { "fn": "mul", "args": [0.3, { "fn": "attribute", "name": "u" }] },
            {
              "fn": "select",
              "args": [
                { "fn": "lt", "args": [{ "fn": "attribute", "name": "c" }, 1.5] },
                3,
                {
                  "fn": "select",
                  "args": [
                    { "fn": "lt", "args": [{ "fn": "attribute", "name": "c" }, 2.5] },
                    {
                      "fn": "add",
                      "args": [
                        3,
                        {
                          "fn": "mul",
                          "args": [
                            2.2,
                            {
                              "fn": "sin",
                              "args": [
                                { "fn": "mul", "args": [2.4, { "fn": "attribute", "name": "u" }] }
                              ]
                            }
                          ]
                        }
                      ]
                    },
                    {
                      "fn": "select",
                      "args": [
                        { "fn": "lt", "args": [{ "fn": "attribute", "name": "c" }, 3.5] },
                        {
                          "fn": "add",
                          "args": [
                            { "fn": "mul", "args": [0.25, { "fn": "attribute", "name": "u" }] },
                            {
                              "fn": "mul",
                              "args": [
                                4,
                                {
                                  "fn": "lt",
                                  "args": [
                                    {
                                      "fn": "abs",
                                      "args": [
                                        { "fn": "sub", "args": [{ "fn": "attribute", "name": "u" }, 12] }
                                      ]
                                    },
                                    0.5
                                  ]
                                }
                              ]
                            }
                          ]
                        },
                        { "fn": "mul", "args": [6, { "fn": "attribute", "name": "u" }] }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    {
      "id": "keep",
      "type": "filterByExpression",
      "params": {
        "predicate": {
          "fn": "lt",
          "args": [
            { "fn": "attribute", "name": "u" },
            {
              "fn": "sub",
              "args": [
                20,
                {
                  "fn": "mul",
                  "args": [18, { "fn": "gt", "args": [{ "fn": "attribute", "name": "c" }, 3.5] }]
                }
              ]
            }
          ]
        }
      }
    },
    {
      "id": "shift",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "mul",
          "args": [
            { "fn": "normalize", "args": [{ "fn": "position" }] },
            { "fn": "attribute", "name": "off" }
          ]
        }
      }
    },
    {
      "id": "props",
      "type": "pointsToPath",
      "params": { "closed": true }
    },
    {
      "id": "lapLen",
      "type": "promoteAttribute",
      "params": { "name": "lapLength", "from": "point", "to": "primitive", "mode": "average" }
    },
    {
      "id": "fit",
      "type": "runFit",
      "params": {
        "arcAttr": "station",
        "valueAttr": "off",
        "gap": 5,
        "period": { "fn": "attribute", "name": "lapLength" },
        "wrap": true,
        "slopeAttr": "runSlope",
        "residualAttr": "runResidual",
        "spanAttr": "runSpan",
        "idAttr": "runId",
        "indexAttr": "runIndex",
        "countAttr": "runCount",
        "startAttr": "runStart"
      }
    },
    {
      "id": "tint",
      "type": "setAttribute",
      "params": {
        "name": "color",
        "tupleSize": 3,
        "value": {
          "fn": "vec",
          "args": [
            {
              "fn": "sub",
              "args": [
                1,
                { "fn": "lt", "args": [{ "fn": "attribute", "name": "runResidual" }, 1] }
              ]
            },
            {
              "fn": "mul",
              "args": [
                { "fn": "lt", "args": [{ "fn": "attribute", "name": "runResidual" }, 1] },
                { "fn": "gt", "args": [{ "fn": "attribute", "name": "runCount" }, 2.5] }
              ]
            },
            {
              "fn": "mul",
              "args": [
                { "fn": "lt", "args": [{ "fn": "attribute", "name": "runResidual" }, 1] },
                {
                  "fn": "sub",
                  "args": [
                    1,
                    { "fn": "gt", "args": [{ "fn": "attribute", "name": "runCount" }, 2.5] }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    {
      "id": "rows",
      "type": "pointsToPath",
      "params": { "closed": false, "groupAttr": "runId", "orderAttr": "runIndex" }
    }
  ],
  "connections": [
    { "from": ["loop", "out"], "to": ["lap", "in"] },
    { "from": ["lap", "out"], "to": ["len", "in"] },
    { "from": ["len", "out"], "to": ["u", "in"] },
    { "from": ["u", "out"], "to": ["c", "in"] },
    { "from": ["c", "out"], "to": ["off", "in"] },
    { "from": ["off", "out"], "to": ["keep", "in"] },
    { "from": ["keep", "out"], "to": ["shift", "in"] },
    { "from": ["shift", "out"], "to": ["props", "in"] },
    { "from": ["props", "out"], "to": ["lapLen", "in"] },
    { "from": ["lapLen", "out"], "to": ["fit", "in"] },
    { "from": ["fit", "out"], "to": ["tint", "in"] },
    { "from": ["tint", "out"], "to": ["rows", "in"] }
  ],
  "outputs": [
    { "id": "lap", "pin": "out", "name": "road" },
    { "id": "rows", "pin": "out", "name": "rows" }
  ]
}
`;export{e as default};