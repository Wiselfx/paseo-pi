import { describe, expect, it } from "vitest";
import { looksLikePackageSource, normalizePackageInput } from "../shared/source";

describe("normalizePackageInput", () => {
	it.each([
		["pi install npm:@gotgenes/pi-permission-system", "npm:@gotgenes/pi-permission-system"],
		["pi add git:github.com/owner/repo", "git:github.com/owner/repo"],
		["  pi   install   https://example.com/pkg.tgz  ", "https://example.com/pkg.tgz"],
		["$ pi install npm:pi-tools", "npm:pi-tools"],
		["`pi install npm:pi-tools`", "npm:pi-tools"],
		['pi install "npm:pi-tools"', "npm:pi-tools"],
		["npm:pi-tools", "npm:pi-tools"],
		["./local-package", "./local-package"],
		["/home/me/extensions/x.ts", "/home/me/extensions/x.ts"],
	])("%s -> %s", (input, expected) => {
		expect(normalizePackageInput(input)).toBe(expected);
	});

	it("only recognises package prefixes, not paths", () => {
		expect(looksLikePackageSource("npm:pi-tools")).toBe(true);
		expect(looksLikePackageSource("git:github.com/a/b")).toBe(true);
		expect(looksLikePackageSource("/home/me/x.ts")).toBe(false);
		expect(looksLikePackageSource("./package")).toBe(false);
	});
});
