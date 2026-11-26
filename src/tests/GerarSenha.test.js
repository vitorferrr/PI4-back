import { describe, expect, it } from "vitest";
import gerarSenha from "../utils/gerarSenha.js";

describe("gerarSenha", () => {
  it("gera três blocos de 4 caracteres separados por hífen", () => {
    expect(gerarSenha()).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  });

  it("sempre tem letras e números e evita caracteres parecidos", () => {
    for (let i = 0; i < 200; i += 1) {
      const senha = gerarSenha();
      expect(senha).toMatch(/[A-Za-z]/);
      expect(senha).toMatch(/\d/);
      expect(senha).not.toMatch(/[0O1lIoiL]/);
    }
  });

  it("não repete a senha entre cadastros", () => {
    const senhas = new Set(Array.from({ length: 200 }, gerarSenha));
    expect(senhas.size).toBe(200);
  });
});
