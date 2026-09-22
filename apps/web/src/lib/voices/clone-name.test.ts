import { describe, expect, it } from "vitest";

import { cloneName, parseCloneName } from "./clone-name";

describe("a clone's name", () => {
  it("is the slot for English, as every existing clone is", () => {
    expect(cloneName("dwarf-male-grim", "enUS")).toBe("dwarf-male-grim");
    expect(parseCloneName("dwarf-male-grim")).toEqual({ voice: "dwarf-male-grim", lang: "enUS" });
  });

  it("carries another language after an @", () => {
    expect(cloneName("dwarf-male-grim", "deDE")).toBe("dwarf-male-grim@deDE");
    expect(parseCloneName("dwarf-male-grim@deDE")).toEqual({ voice: "dwarf-male-grim", lang: "deDE" });
  });

  it("is nothing this app would write otherwise", () => {
    expect(parseCloneName("dwarf-male-grim@enUS")).toBeNull();
    expect(parseCloneName("dwarf-male-grim@xxYY")).toBeNull();
    expect(parseCloneName("a@b@c")).toBeNull();
  });
});
