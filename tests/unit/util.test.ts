import { it, expect } from "bun:test";
import { flattenJSON } from "../../src/util";

it("should flatten arrays in json", () => {
  const json = {
    foo: "bar",
    baz: {
      buzz: "off",
    },
    arr: ["zero", "one", "two"],
  };

  const flattened = flattenJSON(json);

  expect(flattened).toEqual({
    foo: "bar",
    "arr.0": "zero",
    "arr.1": "one",
    "arr.2": "two",
    "baz.buzz": "off",
  });
});
