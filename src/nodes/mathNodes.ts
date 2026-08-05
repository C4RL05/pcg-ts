/**
 * Value nodes: minimal plumbing for plain values flowing through value
 * pins.
 */
import { makeValueItem } from "../graph/index.js";
import { standardNode } from "./registry.js";

/** Params of {@link valueConstant}. */
export interface ValueConstantParams {
  value: number;
}

/** Emit a constant number as a value item. */
export const valueConstant = standardNode<ValueConstantParams>({
  type: "valueConstant",
  category: "value",
  description:
    "Emits a single constant number as a value item, for feeding value pins or tagging pipelines with plain data.",
  inputs: [],
  outputs: [{ name: "out", kind: "value" }],
  params: {
    value: { type: "f32", default: 0, description: "The number to emit." },
  },
  execute({ params }) {
    return { out: [makeValueItem(params.value)] };
  },
});
