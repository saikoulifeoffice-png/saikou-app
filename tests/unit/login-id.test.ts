import { describe, expect, it } from "vitest";
import { displayLoginId, toAuthEmail } from "@/lib/auth/login-id";

describe("ログインID", () => {
  it("IDを内部アドレスに変換し、メールアドレスはそのまま", () => {
    expect(toAuthEmail("Yamada")).toBe("yamada@login.saikou.invalid");
    expect(toAuthEmail(" ichinotani ")).toBe("ichinotani@login.saikou.invalid");
    expect(toAuthEmail("Owner@Example.com")).toBe("owner@example.com");
  });
  it("不正な入力は null", () => {
    for (const v of ["ab", "", "山田", "a b c", "x@y", "-abc"]) expect(toAuthEmail(v)).toBeNull();
  });
  it("表示", () => {
    expect(displayLoginId("yamada@login.saikou.invalid")).toBe("yamada");
    expect(displayLoginId("owner@example.com")).toBe("owner@example.com");
  });
});
