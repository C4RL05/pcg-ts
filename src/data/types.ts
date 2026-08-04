/** Element classes that attributes can live on. */
export type Domain = "point" | "vertex" | "primitive" | "detail";

/** All domains in canonical order. */
export const DOMAINS: readonly Domain[] = ["point", "vertex", "primitive", "detail"];

/** Storage types for attribute columns. */
export type AttrType = "f32" | "i32" | "u32" | "bool" | "string";

/**
 * Maps each {@link AttrType} to its backing typed-array type.
 * `bool` stores 0/1 bytes; `string` stores Uint32 indices into the
 * attribute's per-attribute string table.
 */
export interface AttrTypeMap {
  f32: Float32Array;
  i32: Int32Array;
  u32: Uint32Array;
  bool: Uint8Array;
  string: Uint32Array;
}

/** Any attribute column array. */
export type AttrData = AttrTypeMap[AttrType];

/** Typed-array constructor per attribute type. */
export const ATTR_CTORS: { readonly [K in AttrType]: new (length: number) => AttrTypeMap[K] } = {
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
  bool: Uint8Array,
  string: Uint32Array,
};

/**
 * Default value accepted when creating an attribute: a scalar broadcast
 * across the tuple, a per-component tuple, or a string for string
 * attributes.
 */
export type AttrDefault = number | ArrayLike<number> | string;
