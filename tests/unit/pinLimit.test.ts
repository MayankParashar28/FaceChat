import { describe, it, expect } from "vitest";
import { pinsToEvict, PIN_LIMIT } from "../../server/services/pinLimit";

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

/** A pin, identified by the id so the ordering is readable in assertions. */
const pin = (id: string, pinnedAt: Date | null, createdAt = at(1000)) => ({
  id,
  pinnedAt,
  createdAt,
});

describe("pinsToEvict", () => {
  it("leaves a list that is within the limit alone", () => {
    const pins = [pin("a", at(3)), pin("b", at(2)), pin("c", at(1))];

    expect(pinsToEvict(pins)).toEqual([]);
  });

  it("drops the oldest pin when one too many arrives", () => {
    const pins = [pin("oldest", at(40)), pin("b", at(3)), pin("c", at(2)), pin("newest", at(1))];

    expect(pinsToEvict(pins).map((p) => p.id)).toEqual(["oldest"]);
  });

  it("never drops the pin that was just made", () => {
    // The newest pin is the one being added, so it has to survive.
    const pins = [pin("a", at(40)), pin("b", at(30)), pin("c", at(20)), pin("just-now", at(0))];

    expect(pinsToEvict(pins).map((p) => p.id)).not.toContain("just-now");
  });

  it("drops several at once if a list got over the limit some other way", () => {
    const pins = [
      pin("a", at(50)),
      pin("b", at(40)),
      pin("c", at(30)),
      pin("d", at(20)),
      pin("e", at(10)),
    ];

    expect(pinsToEvict(pins).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("dates a pin made before pinnedAt existed by the message itself", () => {
    // Without the fallback this would read as a pin from the epoch — or, if
    // it sorted as "now", would evict a pin somebody had just made.
    const legacy = pin("legacy", null, at(500));
    const pins = [legacy, pin("b", at(3)), pin("c", at(2)), pin("d", at(1))];

    expect(pinsToEvict(pins).map((p) => p.id)).toEqual(["legacy"]);
  });

  it("keeps a recent legacy pin over an older one", () => {
    const pins = [
      pin("old-legacy", null, at(900)),
      pin("new-legacy", null, at(5)),
      pin("b", at(4)),
      pin("c", at(3)),
    ];

    expect(pinsToEvict(pins).map((p) => p.id)).toEqual(["old-legacy"]);
  });

  it("caps at three", () => {
    expect(PIN_LIMIT).toBe(3);
  });
});
