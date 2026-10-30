import { describe, it, expect } from "vitest";
import { describeMessage } from "../../client/src/lib/messagePreview";

const photo = { mimeType: "image/jpeg", name: "IMG_4821.jpg" };
const pdf = { mimeType: "application/pdf", name: "lease.pdf" };

describe("describeMessage", () => {
  it("reads a text message as itself", () => {
    expect(describeMessage({ content: "on my way" })).toEqual({ kind: "text", label: "on my way" });
  });

  it("calls an uncaptioned photo a photo, not a file name", () => {
    // The uploader never typed anything; content is the file name standing in.
    const preview = describeMessage({ content: photo.name, attachment: photo });

    expect(preview.kind).toBe("photo");
    expect(preview.label).toBe("Photo");
    expect(preview.detail).toBe("IMG_4821.jpg");
  });

  it("leads with the caption when there is one", () => {
    const preview = describeMessage({ content: "the kitchen", attachment: photo });

    expect(preview.label).toBe("the kitchen");
    expect(preview.detail).toBe("IMG_4821.jpg");
  });

  it("names a document, since the file name is the useful part", () => {
    const preview = describeMessage({ content: pdf.name, attachment: pdf });

    expect(preview).toEqual({ kind: "file", label: "lease.pdf" });
  });

  it("prefers a caption over the document's name", () => {
    const preview = describeMessage({ content: "sign page 4", attachment: pdf });

    expect(preview.label).toBe("sign page 4");
    expect(preview.detail).toBe("lease.pdf");
  });

  it("treats whitespace as no caption at all", () => {
    expect(describeMessage({ content: "   ", attachment: photo }).label).toBe("Photo");
  });

  it("passes a system message through untouched", () => {
    const preview = describeMessage({ content: "Ritik joined", messageType: "system" });

    expect(preview).toEqual({ kind: "system", label: "Ritik joined" });
  });

  it("gives an empty message something to show", () => {
    // Nothing should render as a blank row in the pinned list.
    expect(describeMessage({ content: "" }).label).toBe("Message");
  });
});
