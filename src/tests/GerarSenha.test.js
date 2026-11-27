import { describe, expect, it } from "vitest";
import gerarSenha from "../utils/gerarSenha.js";

describe("gerarSenha", () => {
  it("gera 12 caracteres seguidos, sem hífen", () => {
    expect(gerarSenha()).toMatch(/^[A-Z2-9]{12}$/);
  });

  it("usa só maiúsculas e números, sempre os dois, sem caracteres parecidos", () => {
    for (let i = 0; i < 200; i += 1) {
      const senha = gerarSenha();
      expect(senha).toMatch(/[A-Z]/);
      expect(senha).toMatch(/\d/);
      expect(senha).not.toMatch(/[a-z01OI]/);
    }
  });

  it("não repete a senha entre cadastros", () => {
    const senhas = new Set(Array.from({ length: 200 }, gerarSenha));
    expect(senhas.size).toBe(200);
  });
});
